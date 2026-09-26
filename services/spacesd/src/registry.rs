//! The list of spaces, kept in /var/lib/newos/spaces.json. Names and accents are not secret;
//! passwords live only in /etc/shadow, like any account's.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Space {
    /// The account name, e.g. "space-work". Also the id other methods take.
    pub account: String,
    /// What the user calls it: "Work", "Personal".
    pub name: String,
    /// An accent name from the design tokens ("blue", "pink", ...).
    pub accent: String,
    /// The space the greeter shows first (its wallpaper and accent) and the lock screen falls
    /// back to.
    #[serde(default)]
    pub default: bool,
    /// Unix seconds of the last login, so the most used space is tried first.
    #[serde(default)]
    pub last_used: u64,
}

pub const ACCENTS: [&str; 8] = ["blue", "purple", "pink", "red", "orange", "yellow", "green", "graphite"];

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Registry {
    #[serde(skip)]
    path: PathBuf,
    pub spaces: Vec<Space>,
}

pub fn check_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 40 || name.chars().any(char::is_control) {
        return Err(Error::Invalid("A space needs a name of up to 40 characters.".into()));
    }
    Ok(name.to_string())
}

pub fn check_accent(accent: &str) -> Result<String> {
    if ACCENTS.contains(&accent) {
        Ok(accent.to_string())
    } else {
        Err(Error::Invalid(format!("unknown accent: {accent}")))
    }
}

/// Only names this service generated are ever passed to useradd/userdel.
pub fn valid_account(account: &str) -> bool {
    let mut chars = account.chars();
    account.len() <= 32
        && account.starts_with("space-")
        && chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && account.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !account.ends_with('-')
}

/// "Work & Play" -> "work-play". Non-ASCII letters are dropped; an empty result becomes "space".
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').chars().take(20).collect::<String>();
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "space".into()
    } else {
        out
    }
}

impl Registry {
    pub fn load(path: &Path) -> Result<Self> {
        let mut registry: Registry = match std::fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| Error::Invalid(format!("{}: {e}", path.display())))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Registry::default(),
            Err(e) => return Err(e.into()),
        };
        registry.path = path.to_path_buf();
        Ok(registry)
    }

    pub fn save(&self) -> Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(self)? + "\n")?;
        std::fs::rename(tmp, &self.path)?;
        Ok(())
    }

    /// A copy of the spaces for work outside the lock (password checks); it cannot be saved.
    pub fn snapshot(&self) -> Registry {
        Registry { path: PathBuf::new(), spaces: self.spaces.clone() }
    }

    pub fn get(&self, account: &str) -> Result<&Space> {
        self.spaces.iter().find(|s| s.account == account).ok_or_else(|| Error::Invalid(format!("no space {account}")))
    }

    fn get_mut(&mut self, account: &str) -> Result<&mut Space> {
        self.spaces.iter_mut().find(|s| s.account == account).ok_or_else(|| Error::Invalid(format!("no space {account}")))
    }

    /// A free account name for a new space called `name`.
    pub fn new_account(&self, name: &str, exists: impl Fn(&str) -> bool) -> String {
        let base = format!("space-{}", slug(name));
        let taken = |a: &str| self.spaces.iter().any(|s| s.account == a) || exists(a);
        if !taken(&base) {
            return base;
        }
        (2..).map(|n| format!("{base}-{n}")).find(|a| !taken(a)).unwrap()
    }

    pub fn add(&mut self, space: Space) {
        let first = self.spaces.is_empty();
        self.spaces.push(Space { default: space.default || first, ..space });
    }

    pub fn remove(&mut self, account: &str) -> Result<Space> {
        let index = self.spaces.iter().position(|s| s.account == account).ok_or_else(|| Error::Invalid(format!("no space {account}")))?;
        let removed = self.spaces.remove(index);
        if removed.default {
            if let Some(first) = self.spaces.first_mut() {
                first.default = true;
            }
        }
        Ok(removed)
    }

    pub fn rename(&mut self, account: &str, name: &str) -> Result<()> {
        self.get_mut(account)?.name = check_name(name)?;
        Ok(())
    }

    pub fn set_accent(&mut self, account: &str, accent: &str) -> Result<()> {
        self.get_mut(account)?.accent = check_accent(accent)?;
        Ok(())
    }

    pub fn set_default(&mut self, account: &str) -> Result<()> {
        self.get(account)?;
        for space in &mut self.spaces {
            space.default = space.account == account;
        }
        Ok(())
    }

    pub fn touch(&mut self, account: &str, now: u64) {
        if let Ok(space) = self.get_mut(account) {
            space.last_used = now;
        }
    }

    /// Spaces in the order passwords are tried: most recently used first, then the default.
    pub fn try_order(&self) -> Vec<&Space> {
        let mut order: Vec<&Space> = self.spaces.iter().collect();
        order.sort_by(|a, b| b.last_used.cmp(&a.last_used).then(b.default.cmp(&a.default)));
        order
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn space(account: &str, last_used: u64) -> Space {
        Space { account: account.into(), name: account.into(), accent: "blue".into(), default: false, last_used }
    }

    #[test]
    fn slugs_and_accounts() {
        assert_eq!(slug("Work & Play!"), "work-play");
        assert_eq!(slug("Été"), "t");
        assert_eq!(slug("???"), "space");
        assert!(valid_account("space-work"));
        assert!(valid_account("space-work-2"));
        assert!(!valid_account("root"));
        assert!(!valid_account("space-"));
        assert!(!valid_account("space-Work"));
        assert!(!valid_account("space-a;rm -rf /"));
        let mut registry = Registry::default();
        registry.add(space("space-work", 0));
        assert_eq!(registry.new_account("Work", |_| false), "space-work-2");
        assert_eq!(registry.new_account("Home", |a| a == "space-home"), "space-home-2");
    }

    #[test]
    fn first_space_is_the_default_and_removal_moves_it() {
        let mut registry = Registry::default();
        registry.add(space("space-a", 0));
        registry.add(space("space-b", 0));
        assert!(registry.get("space-a").unwrap().default);
        registry.remove("space-a").unwrap();
        assert!(registry.get("space-b").unwrap().default);
        registry.add(space("space-c", 0));
        registry.set_default("space-c").unwrap();
        assert!(!registry.get("space-b").unwrap().default);
        assert!(registry.set_default("space-zzz").is_err());
    }

    #[test]
    fn tries_the_most_recent_space_first() {
        let mut registry = Registry::default();
        registry.add(space("space-old", 10));
        registry.add(space("space-new", 20));
        registry.add(space("space-never", 0));
        let order: Vec<_> = registry.try_order().iter().map(|s| s.account.clone()).collect();
        assert_eq!(order, ["space-new", "space-old", "space-never"]);
    }

    #[test]
    fn saves_and_loads() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("newos/spaces.json");
        let mut registry = Registry::load(&path).unwrap();
        registry.add(space("space-work", 5));
        registry.rename("space-work", "Work").unwrap();
        registry.set_accent("space-work", "pink").unwrap();
        assert!(registry.set_accent("space-work", "chartreuse").is_err());
        assert!(registry.rename("space-work", "   ").is_err());
        registry.save().unwrap();
        let loaded = Registry::load(&path).unwrap();
        assert_eq!(loaded.spaces, registry.spaces);
    }
}
