//! The hardware and software summary for Settings → About.

use std::path::Path;

use crate::runner::{run_checked, CommandRunner};

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct AboutInfo {
    pub hostname: String,
    pub vendor: String,
    /// "HP Laptop 14-dq2xxx"
    pub model: String,
    /// Manufacturer SKU, e.g. "50V33UA#ABA"
    pub sku: String,
    pub firmware: String,
    /// "11th Gen Intel(R) Core(TM) i3-1125G4 @ 2.00GHz"
    pub cpu: String,
    pub cpu_cores: usize,
    pub memory_bytes: u64,
    pub graphics: Vec<String>,
    /// The base distribution's PRETTY_NAME.
    pub base_os: String,
    pub kernel: String,
    pub disk_total_bytes: u64,
    pub disk_free_bytes: u64,
}

fn read_trimmed(path: impl AsRef<Path>) -> String {
    std::fs::read_to_string(path).map(|s| s.trim().to_string()).unwrap_or_default()
}

/// First "model name" and the number of processors in /proc/cpuinfo.
pub fn parse_cpuinfo(text: &str) -> (String, usize) {
    let model = text
        .lines()
        .find_map(|l| l.strip_prefix("model name").and_then(|r| r.split_once(':')).map(|(_, v)| v.trim().to_string()))
        .unwrap_or_default();
    let cores = text.lines().filter(|l| l.starts_with("processor")).count();
    (model, cores)
}

/// "MemTotal: 16126740 kB" -> bytes.
pub fn parse_meminfo(text: &str) -> u64 {
    text.lines()
        .find_map(|l| l.strip_prefix("MemTotal:"))
        .and_then(|v| v.split_whitespace().next()?.parse::<u64>().ok())
        .map(|kb| kb * 1024)
        .unwrap_or(0)
}

pub fn parse_os_release(text: &str) -> String {
    text.lines().find_map(|l| l.strip_prefix("PRETTY_NAME=")).map(|v| v.trim_matches('"').to_string()).unwrap_or_else(|| "Linux".into())
}

/// Display controllers from `lspci`, without the bus address and revision:
/// "00:02.0 VGA compatible controller: Intel Corporation Tiger Lake-LP GT2 [UHD Graphics G4] (rev 01)"
/// -> "Intel Corporation Tiger Lake-LP GT2 [UHD Graphics G4]".
pub fn parse_lspci_graphics(text: &str) -> Vec<String> {
    text.lines()
        .filter(|l| l.contains("VGA compatible controller") || l.contains("3D controller") || l.contains("Display controller"))
        .filter_map(|l| l.split_once(": ").map(|(_, v)| v))
        .map(|v| v.rsplit_once(" (rev").map(|(name, _)| name).unwrap_or(v).trim().to_string())
        .collect()
}

/// `df -B1 --output=size,avail /` -> (total, free).
pub fn parse_df(text: &str) -> (u64, u64) {
    text.lines()
        .nth(1)
        .and_then(|l| {
            let mut parts = l.split_whitespace().map(|p| p.parse::<u64>().ok());
            Some((parts.next()??, parts.next()??))
        })
        .unwrap_or((0, 0))
}

pub async fn about(runner: &dyn CommandRunner) -> AboutInfo {
    let dmi = Path::new("/sys/class/dmi/id");
    let (cpu, cpu_cores) = parse_cpuinfo(&read_trimmed("/proc/cpuinfo"));
    let lspci = run_checked(runner, "lspci", &[]).await.unwrap_or_default();
    let df = run_checked(runner, "df", &["-B1", "--output=size,avail", "/"]).await.unwrap_or_default();
    let (disk_total_bytes, disk_free_bytes) = parse_df(&df);
    AboutInfo {
        hostname: read_trimmed("/proc/sys/kernel/hostname"),
        vendor: read_trimmed(dmi.join("sys_vendor")),
        model: read_trimmed(dmi.join("product_name")),
        sku: read_trimmed(dmi.join("product_sku")),
        firmware: read_trimmed(dmi.join("bios_version")),
        cpu,
        cpu_cores,
        memory_bytes: parse_meminfo(&read_trimmed("/proc/meminfo")),
        graphics: parse_lspci_graphics(&lspci),
        base_os: parse_os_release(&read_trimmed("/etc/os-release")),
        kernel: read_trimmed("/proc/sys/kernel/osrelease"),
        disk_total_bytes,
        disk_free_bytes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_proc_files() {
        let cpu = "processor\t: 0\nmodel name\t: 11th Gen Intel(R) Core(TM) i3-1125G4 @ 2.00GHz\nprocessor\t: 1\nmodel name\t: same\n";
        assert_eq!(parse_cpuinfo(cpu), ("11th Gen Intel(R) Core(TM) i3-1125G4 @ 2.00GHz".into(), 2));
        assert_eq!(parse_meminfo("MemTotal:       16126740 kB\nMemFree: 1 kB\n"), 16126740 * 1024);
        assert_eq!(parse_os_release("NAME=\"CachyOS Linux\"\nPRETTY_NAME=\"CachyOS\"\n"), "CachyOS");
    }

    #[test]
    fn parses_graphics_and_disk() {
        let lspci = "00:02.0 VGA compatible controller: Intel Corporation Tiger Lake-LP GT2 [UHD Graphics G4] (rev 01)\n00:1f.3 Multimedia audio controller: Intel Corporation Audio (rev 20)\n";
        assert_eq!(parse_lspci_graphics(lspci), ["Intel Corporation Tiger Lake-LP GT2 [UHD Graphics G4]"]);
        assert_eq!(parse_df("    1B-blocks        Avail\n252000000000 220000000000\n"), (252000000000, 220000000000));
        assert_eq!(parse_df(""), (0, 0));
    }
}
