//! Interpret the current SSH user's TigerVNC inventory, including older two-column listings.
use crate::commands::{Action, ExecutionMode, Service};

fn words(action: &Action) -> Option<Vec<&str>> {
    // The built-in recipes use plain or individually quoted literal words.
    // Never interpret a shell expression or derive an instance from a command chain.
    if action.command.trim().contains(['\n', '\r']) {
        return None;
    }
    let words: Vec<_> = action
        .command
        .split_ascii_whitespace()
        .map(|word| {
            for quote in ['\'', '"'] {
                if let Some(inner) = word.strip_prefix(quote).and_then(|s| s.strip_suffix(quote)) {
                    return inner;
                }
            }
            word
        })
        .collect();
    if !words.iter().all(|s| {
        !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"/_.:-=".contains(&b))
    }) {
        return None;
    }
    match words.first()?.rsplit('/').next()? {
        "vncserver" | "tigervncserver" => Some(words),
        _ => None,
    }
}

pub(super) fn list_action(action: &Action) -> bool {
    action.kind == "status"
        && action.mode == ExecutionMode::Command
        && words(action).is_some_and(|w| matches!(&w[1..], ["-list"]))
}

fn configured_display(service: &Service) -> Result<Option<u16>, String> {
    let mut display = None;
    for action in service
        .actions
        .iter()
        .filter(|a| matches!(a.kind.as_str(), "start" | "stop"))
    {
        let Some(argv) = words(action) else { continue };
        let target = match (action.kind.as_str(), &argv[1..]) {
            ("stop", ["-kill", value]) | ("start", [value, ..]) => value,
            _ => continue,
        };
        if let Some(number) = target.strip_prefix(':').and_then(|s| s.parse::<u16>().ok()) {
            if display
                .replace(number)
                .is_some_and(|previous| previous != number)
            {
                return Err("vncStatusUnknown".into());
            }
        }
    }
    Ok(display)
}

pub(super) fn status(service: &Service, stdout: &[u8]) -> Result<String, String> {
    let display = configured_display(service)?;
    if display.is_none() && service.port.is_none() {
        return Err("vncStatusUnknown".into());
    }
    let mut lines = std::str::from_utf8(stdout)
        .map_err(|_| "vncStatusUnknown")?
        .lines();
    let (has_port, has_path, has_server) = lines
        .find_map(|line| {
            let fields = line
                .split_ascii_whitespace()
                .filter(|field| *field != "#")
                .collect::<Vec<_>>()
                .join(" ")
                .to_ascii_uppercase();
            match fields.as_str() {
                "X DISPLAY PROCESS ID" => Some((false, false, false)),
                "X DISPLAY RFB PORT PROCESS ID" => Some((true, false, false)),
                "X DISPLAY RFB PORT PROCESS ID SERVER" => Some((true, false, true)),
                "X DISPLAY RFB PORT RFB UNIX PATH PROCESS ID SERVER" => Some((true, true, true)),
                _ => None,
            }
        })
        .ok_or("vncStatusUnknown")?;
    let mut running = false;
    for line in lines.map(str::trim).filter(|s| !s.is_empty()) {
        let mut fields: Vec<_> = line.split_ascii_whitespace().collect();
        let stale = fields.contains(&"(stale)");
        fields.retain(|f| *f != "(stale)");
        if has_server {
            fields.pop().ok_or("vncStatusUnknown")?;
        }
        let pid = fields
            .pop()
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        if pid == 0 {
            return Err("vncStatusUnknown".into());
        }
        let mut fields = fields.into_iter();
        let first = fields.next().ok_or("vncStatusUnknown")?;
        let row_display = first
            .strip_prefix(':')
            .unwrap_or(first)
            .parse::<u16>()
            .map_err(|_| "vncStatusUnknown")?;
        let row_port = if has_port {
            let value = fields.next().ok_or("vncStatusUnknown")?;
            Some(value.parse::<u16>().map_err(|_| "vncStatusUnknown")?)
        } else {
            None
        };
        if let Some(path) = fields.next() {
            if !has_path || !path.starts_with('/') || fields.next().is_some() {
                return Err("vncStatusUnknown".into());
            }
        }
        let matches_display = display.is_none_or(|d| d == row_display);
        // Older wrappers omit the RFB port. Conflicting targets need a richer listing.
        let port = row_port.or_else(|| row_display.checked_add(5900));
        let matches_port = service
            .port
            .is_none_or(|configured| Some(configured) == port);
        if !stale && display.is_some() && service.port.is_some() && matches_display != matches_port
        {
            return Err("vncStatusUnknown".into());
        }
        running |= matches_display && matches_port && !stale;
    }
    Ok(if running { "running" } else { "stopped" }.into())
}
