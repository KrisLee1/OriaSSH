//! Bounded POSIX-sh templates, never evaluated locally. No arbitrary substitution or sudo.
use crate::{
    commands::{Action, ExecutionMode},
    service_control::{Control, StatusProbe},
};
use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub actions: Vec<Action>,
    pub control: Control,
    pub resource: String,
    pub shell: String,
}
pub(crate) fn systemd_status(tool: &str, quoted: &str, transient: bool) -> String {
    let check = if transient {
        r#"
load_result=$?
[ "$load" != not-found ] || exit 3
[ "$load_result" -eq 0 ] && [ "$load" = loaded ] || exit 5"#
    } else {
        r#" || exit 5
[ "$load" = loaded ] || exit 5"#
    };
    format!("load=$({tool} show --property=LoadState --value -- {quoted}){check}\nstate=$({tool} show --property=ActiveState --value -- {quoted}) || exit 5\ncase \"$state\" in\n  active) exit 0 ;;\n  inactive) exit 3 ;;\n  failed) exit 4 ;;\n  *) exit 5 ;;\nesac")
}
pub fn build(kind: &str, resource: &str) -> Result<Template, String> {
    let valid = resource.len() <= 128
        && resource
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && resource
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-@:".contains(&c));
    if !valid {
        return Err("templateInvalid".into());
    }
    let (tool, target) = match kind {
        "systemdUser" | "systemdSystem" => {
            let target = if resource.ends_with(".service") {
                resource.to_string()
            } else {
                format!("{resource}.service")
            };
            (
                if kind == "systemdUser" {
                    "systemctl --user"
                } else {
                    "systemctl"
                },
                target,
            )
        }
        "docker" => {
            if resource.bytes().any(|c| b"@:".contains(&c)) {
                return Err("templateInvalid".into());
            }
            ("docker", resource.into())
        }
        _ => return Err("templateUnsupported".into()),
    };
    // Resource allowlist forbids quotes, whitespace, expansions and option prefixes.
    let quoted = format!("'{target}'");
    let status = if kind == "docker" {
        format!("state=$(docker inspect --type container --format '{{{{.State.Status}}}}' -- {quoted}) || exit 5\ncase \"$state\" in\n  running) exit 0 ;;\n  exited|created) exit 3 ;;\n  dead) exit 4 ;;\n  *) exit 5 ;;\nesac")
    } else {
        systemd_status(tool, &quoted, false)
    };
    let mut actions = Vec::new();
    for verb in ["start", "stop", "restart", "status", "logs"] {
        let command = match verb {
            "status" => status.clone(),
            "logs" => {
                if kind == "docker" {
                    format!("docker logs --tail 100 -- {quoted}")
                } else {
                    format!(
                        "journalctl {}--no-pager --lines=100 --unit={quoted}",
                        if kind == "systemdUser" { "--user " } else { "" }
                    )
                }
            }
            _ => format!("{tool} {verb} -- {quoted}"),
        };
        actions.push(Action {
            systemd_launch: None,
            service_port_variable: false,
            invocation: None,
            id: uuid::Uuid::new_v4().to_string(),
            kind: verb.into(),
            label: verb.into(),
            command,
            mode: ExecutionMode::Command,
            timeout_secs: if verb == "status" { 15 } else { 60 },
            success_codes: vec![0],
            confirm: matches!(verb, "stop" | "restart"),
        });
    }
    let control = Control {
        status_probe: Some(StatusProbe {
            action_id: actions[3].id.clone(),
            mode: "exitCode".into(),
            running_codes: vec![0],
            stopped_codes: vec![3],
            failed_codes: vec![4],
        }),
        start_action_id: Some(actions[0].id.clone()),
        ..Default::default()
    };
    Ok(Template {
        actions,
        control,
        resource: target,
        shell: "POSIX sh".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn managed_launch_preserves_authored_command_and_executes_the_expected_argv() {
        use crate::commands::{SystemdLaunch, SystemdLaunchMode};
        use std::{os::unix::fs::PermissionsExt, process::Command};

        let dir = tempfile::tempdir().unwrap();
        for (name, script) in [
            ("id", "printf '1000\\n'"),
            ("loginctl", "printf '%s\\n' \"$LINGER\""),
            (
                "systemctl",
                "if [ \"$2\" = show ]; then printf '%s\\n' \"$STATE\"; exit \"$SHOW_CODE\"; fi\nprintf '%s\\n' \"$@\"",
            ),
            ("systemd-run", "printf '%s\\n' launch \"$@\""),
        ] {
            let file = dir.path().join(name);
            std::fs::write(&file, format!("#!/bin/sh\n{script}\n")).unwrap();
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let mut action: Action = serde_json::from_value(serde_json::json!({
            "id": "start",
            "kind": "start",
            "label": "fixture",
            "command": "'dsh' 'web' '--port' '{{service.port}}'",
            "invocation": {
                "executable": "dsh",
                "arguments": [{"name": "", "value": "web"}, {"name": "--port", "value": "{{service.port}}"}, {"name": "--title", "value": "a '$HOME'"}],
                "environment": [{"name": "MODE", "value": "$literal 中文"}]
            },
            "servicePortVariable": true,
            "systemdLaunch": {"unit": "oria-test.service", "mode": "persistent"},
            "timeoutSecs": 60, "successCodes": [0], "confirm": false,
        }))
        .unwrap();
        action.command = action.invocation.as_ref().unwrap().render().unwrap();
        let authored = action.command.clone();
        let resolved = action.resolved(Some(13085)).unwrap().command;
        assert!(!resolved.contains("systemd-run"));
        assert_eq!(
            action.for_execution(None).unwrap_err(),
            "servicePortRequired"
        );
        let run = |action: &Action, linger: &str, state: &str, code: &str| {
            let mut action = action.for_execution(Some(13085)).unwrap();
            action.use_foreground_timeout();
            assert_eq!(action.timeout_secs, 60);
            Command::new("/bin/sh")
                .args(["-c", &action.command])
                .env("PATH", dir.path())
                .env("LINGER", linger)
                .env("STATE", state)
                .env("SHOW_CODE", code)
                .output()
                .unwrap()
        };
        assert!(!run(&action, "no", "failed", "0").status.success());
        let started = run(&action, "yes", "failed", "0");
        assert!(started.status.success());
        let argv = String::from_utf8(started.stdout).unwrap();
        assert!(argv.starts_with("--user\nreset-failed\n--\noria-test.service\nlaunch\n"));
        assert!(argv.contains(&format!("--setenv=PATH={}\n", dir.path().display())));
        assert!(argv.ends_with(
            "--setenv=MODE=$literal 中文\n--\ndsh\nweb\n--port\n13085\n--title\na '$$HOME'\n"
        ));
        assert!(run(&action, "yes", "active", "0").stdout.is_empty());
        assert_eq!(action.command, authored);
        assert_eq!(
            serde_json::from_str::<Action>(&serde_json::to_string(&action).unwrap())
                .unwrap()
                .for_execution(Some(13085))
                .unwrap()
                .command,
            action.for_execution(Some(13085)).unwrap().command
        );
        action.systemd_launch = Some(SystemdLaunch {
            unit: "oria-test.service".into(),
            mode: SystemdLaunchMode::Transient,
        });
        action.kind = "restart".into();
        let restarted = run(&action, "no", "not-found", "1");
        assert!(restarted.status.success());
        assert_eq!(
            String::from_utf8(restarted.stdout).unwrap(),
            format!("launch\n--user\n--no-ask-password\n--collect\n--unit=oria-test.service\n--setenv=PATH={}\n--setenv=MODE=$literal 中文\n--\ndsh\nweb\n--port\n13085\n--title\na '$$HOME'\n", dir.path().display())
        );
        assert_eq!(
            run(&action, "no", "loaded", "0").stdout,
            b"--user\nrestart\n--\noria-test.service\n",
        );
        assert_eq!(run(&action, "no", "", "1").status.code(), Some(5));
        action.systemd_launch.as_mut().unwrap().unit = "unsafe;whoami.service".into();
        assert_eq!(
            action.for_execution(Some(13085)).unwrap_err(),
            "invalidAction"
        );
    }

    #[cfg(unix)]
    #[test]
    fn collected_unit_is_stopped_but_manager_errors_are_preserved() {
        use std::{os::unix::fs::PermissionsExt, process::Command};
        let dir = tempfile::tempdir().unwrap();
        let stub = dir.path().join("systemctl");
        std::fs::write(
            &stub,
            r#"#!/bin/sh
case "$2" in
  show) printf '%s\n' "$LOAD"; exit "$SHOW_CODE" ;;
  stop) printf '%s\n' "$4"; exit "$STOP_CODE" ;;
  *) exit 99 ;;
esac
"#,
        )
        .unwrap();
        std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut template = build("systemdUser", "oriassh-fixture").unwrap();
        template.actions[0].systemd_launch = Some(crate::commands::SystemdLaunch {
            unit: template.resource.clone(),
            mode: crate::commands::SystemdLaunchMode::Persistent,
        });
        let mut s: crate::commands::Service = serde_json::from_value(serde_json::json!({
            "id":"fixture", "name":"fixture", "revision":"v1", "ruleIds":[], "noLocalEnvironment":true,
            "actions":template.actions, "control":template.control,
        })).unwrap();
        let mut customized = s.actions[1].clone();
        customized.id = "custom-stop".into();
        customized.command.push_str("\nprintf 'custom'");
        s.actions.push(customized.clone());
        s.prepare_managed_actions();
        assert_eq!(s.actions.last().unwrap().command, customized.command);
        let run = |index: usize, load: &str, show: &str, stop: &str| {
            Command::new("/bin/sh")
                .args(["-c", &s.actions[index].command])
                .env("PATH", dir.path())
                .env("LOAD", load)
                .env("SHOW_CODE", show)
                .env("STOP_CODE", stop)
                .output()
                .unwrap()
        };
        let absent = run(1, "not-found", "4", "5");
        assert!(absent.status.success() && absent.stdout.is_empty());
        assert_eq!(run(3, "not-found", "4", "5").status.code(), Some(3));
        let loaded = run(1, "loaded", "0", "0");
        assert!(loaded.status.success());
        assert_eq!(loaded.stdout, b"oriassh-fixture.service\n");
        assert_eq!(run(1, "loaded", "0", "5").status.code(), Some(5));
        assert_eq!(run(1, "", "1", "1").status.code(), Some(1));
        assert_eq!(run(3, "", "1", "1").status.code(), Some(5));
    }

    #[test]
    fn rejects_shell_injection_and_unknown_templates() {
        for bad in [
            "", "-service", "a b", "a\nb", "a;b", "$(id)", "`id`", "a'", "a\"", "a/b", "模型",
            "a\\b",
        ] {
            assert!(build("systemdUser", bad).is_err(), "{bad:?}");
            assert!(build("docker", bad).is_err(), "{bad:?}");
        }
        assert!(build("docker", "a@b").is_err());
        assert!(build("docker", "a:b").is_err());
        assert!(build("systemdUser", &"a".repeat(129)).is_err());
        assert!(build("arbitrary", "service").is_err());
        let t = build("systemdUser", "model@worker").unwrap();
        assert_eq!(t.resource, "model@worker.service");
        assert!(!t.control.check_after_actions);
        assert!(t.control.health_probe.is_none());
        assert_eq!(
            t.control.status_probe.as_ref().unwrap().action_id,
            t.actions[3].id
        );
        assert_eq!(
            build("systemdSystem", "x.service").unwrap().resource,
            "x.service"
        );
    }
    #[cfg(unix)]
    #[test]
    fn posix_templates_parse_and_status_mapping_uses_exact_stub_arguments() {
        use std::{
            io::Write,
            os::unix::fs::PermissionsExt,
            process::{Command, Stdio},
        };
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("argv");
        // Only isolated stubs can be resolved from PATH. Never invoke system services or Docker.
        let stub = "#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$ARG_LOG\"\ncase \"$*\" in\n *LoadState*) printf '%s\\n' \"$LOAD\" ;;\n *) printf '%s\\n' \"$STATE\" ;;\nesac\n";
        for name in ["systemctl", "journalctl", "docker"] {
            let file = dir.path().join(name);
            std::fs::write(&file, stub).unwrap();
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        for kind in ["systemdUser", "systemdSystem", "docker"] {
            let t = build(kind, "model-worker").unwrap();
            for a in &t.actions {
                let mut child = Command::new("/bin/sh")
                    .arg("-n")
                    .stdin(Stdio::piped())
                    .spawn()
                    .unwrap();
                child
                    .stdin
                    .take()
                    .unwrap()
                    .write_all(a.command.as_bytes())
                    .unwrap();
                assert!(child.wait().unwrap().success());
            }
            let cases = if kind == "docker" {
                vec![
                    ("running", 0),
                    ("exited", 3),
                    ("created", 3),
                    ("dead", 4),
                    ("restarting", 5),
                ]
            } else {
                vec![
                    ("active", 0),
                    ("inactive", 3),
                    ("failed", 4),
                    ("activating", 5),
                ]
            };
            for (state, code) in cases {
                std::fs::write(&log, "").unwrap();
                let result = Command::new("/bin/sh")
                    .args(["-c", &t.actions[3].command])
                    .env("PATH", dir.path())
                    .env("ARG_LOG", &log)
                    .env("LOAD", "loaded")
                    .env("STATE", state)
                    .status()
                    .unwrap();
                assert_eq!(result.code(), Some(code));
                let argv = std::fs::read_to_string(&log).unwrap();
                if kind == "docker" {
                    assert_eq!(argv, "inspect\n--type\ncontainer\n--format\n{{.State.Status}}\n--\nmodel-worker\n");
                } else {
                    let prefix = if kind == "systemdUser" {
                        "--user\n"
                    } else {
                        ""
                    };
                    assert_eq!(argv, format!("{prefix}show\n--property=LoadState\n--value\n--\nmodel-worker.service\n{prefix}show\n--property=ActiveState\n--value\n--\nmodel-worker.service\n"));
                }
            }
            if kind != "docker" {
                let result = Command::new("/bin/sh")
                    .args(["-c", &t.actions[3].command])
                    .env("PATH", dir.path())
                    .env("ARG_LOG", &log)
                    .env("LOAD", "not-found")
                    .env("STATE", "inactive")
                    .status()
                    .unwrap();
                assert_eq!(result.code(), Some(5));
            }
        }
    }
}
