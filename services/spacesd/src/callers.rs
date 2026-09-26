//! Who is calling: the D-Bus sender's uid, mapped to a user and groups through the account
//! files. Only root, the greeter, and space accounts may ask which space a password opens.

use std::path::PathBuf;

use crate::accounts::GROUP;

pub const GREETER_USER: &str = "greeter";

#[derive(Debug, Clone)]
pub struct AccountFiles {
    pub passwd: PathBuf,
    pub group: PathBuf,
}

impl Default for AccountFiles {
    fn default() -> Self {
        Self { passwd: "/etc/passwd".into(), group: "/etc/group".into() }
    }
}

/// The user name for `uid` from passwd-format text.
pub fn user_name(passwd: &str, uid: u32) -> Option<String> {
    passwd.lines().find_map(|line| {
        let mut fields = line.split(':');
        let name = fields.next()?;
        fields.next()?;
        (fields.next()?.parse::<u32>().ok()? == uid).then(|| name.to_string())
    })
}

/// True when `user` is listed as a member of `group` in group-format text.
pub fn in_group(group_file: &str, group: &str, user: &str) -> bool {
    group_file.lines().any(|line| {
        let fields: Vec<&str> = line.split(':').collect();
        fields.len() == 4 && fields[0] == group && fields[3].split(',').any(|m| m.trim() == user)
    })
}

impl AccountFiles {
    pub fn user(&self, uid: u32) -> Option<String> {
        user_name(&std::fs::read_to_string(&self.passwd).ok()?, uid)
    }

    /// May this caller ask `ResolvePassword` and `ListSpaces`?
    pub fn may_resolve(&self, uid: u32) -> bool {
        if uid == 0 {
            return true;
        }
        let Some(user) = self.user(uid) else { return false };
        user == GREETER_USER || std::fs::read_to_string(&self.group).is_ok_and(|g| in_group(&g, GROUP, &user))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASSWD: &str = "root:x:0:0::/root:/bin/bash\ngreeter:x:964:964::/var/lib/greeter:/bin/sh\nspace-work:x:1001:1001:Work:/home/space-work:/bin/bash\nmallory:x:1002:1002::/home/mallory:/bin/bash\n";
    const GROUPS: &str = "wheel:x:998:a\nhelixos-spaces:x:970:space-work,space-home\nmallory:x:1002:\n";

    #[test]
    fn maps_uids_and_groups() {
        assert_eq!(user_name(PASSWD, 1001).as_deref(), Some("space-work"));
        assert_eq!(user_name(PASSWD, 4242), None);
        assert!(in_group(GROUPS, "helixos-spaces", "space-work"));
        assert!(!in_group(GROUPS, "helixos-spaces", "mallory"));
    }

    #[test]
    fn only_root_the_greeter_and_spaces_may_resolve() {
        let dir = tempfile::tempdir().unwrap();
        let files = AccountFiles { passwd: dir.path().join("passwd"), group: dir.path().join("group") };
        std::fs::write(&files.passwd, PASSWD).unwrap();
        std::fs::write(&files.group, GROUPS).unwrap();
        assert!(files.may_resolve(0));
        assert!(files.may_resolve(964));
        assert!(files.may_resolve(1001));
        assert!(!files.may_resolve(1002), "an ordinary account");
        assert!(!files.may_resolve(4242), "an unknown uid");
    }
}
