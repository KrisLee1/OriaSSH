//! Launch with ORIASSH_TEST_DATA_DIR and ORIASSH_TEST_SSH_CONFIG for isolated native QA.
#![cfg_attr(windows, windows_subsystem = "windows")]
fn main() {
    oria_ssh_lib::run();
}
