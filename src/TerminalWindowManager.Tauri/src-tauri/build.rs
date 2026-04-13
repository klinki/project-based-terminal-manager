use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR was not set"));
    let helper_project = manifest_dir
        .join("..")
        .join("..")
        .join("TerminalWindowManager.ConPTYHost")
        .join("TerminalWindowManager.ConPTYHost.csproj");
    let helper_dir = helper_project
        .parent()
        .expect("ConPTY host project path had no parent")
        .to_path_buf();
    let helper_resources_dir = manifest_dir
        .join("resources")
        .join("TerminalWindowManager.ConPTYHost");
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let configuration = if profile.eq_ignore_ascii_case("release") {
        "Release"
    } else {
        "Debug"
    };

    emit_rerun_if_changed(&helper_dir);
    if configuration == "Release" {
        let dotnet_cli_home = manifest_dir.join("target").join(".dotnet-cli-home");
        stage_conpty_host(
            &helper_project,
            &helper_resources_dir,
            &dotnet_cli_home,
            configuration,
        );
    }
    tauri_build::build();
}

fn emit_rerun_if_changed(dir: &Path) {
    println!("cargo:rerun-if-changed={}", dir.display());
    let entries = fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("Failed to enumerate {}: {error}", dir.display()));

    for entry in entries {
        let entry = entry.unwrap_or_else(|error| {
            panic!("Failed to enumerate an entry under {}: {error}", dir.display())
        });
        let path = entry.path();
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("bin") || name.eq_ignore_ascii_case("obj"))
        {
            continue;
        }

        if path.is_dir() {
            emit_rerun_if_changed(&path);
            continue;
        }

        println!("cargo:rerun-if-changed={}", path.display());
    }
}

fn stage_conpty_host(
    helper_project: &Path,
    output_dir: &Path,
    dotnet_cli_home: &Path,
    configuration: &str,
) {
    fs::create_dir_all(output_dir).unwrap_or_else(|error| {
        panic!(
            "Failed to create ConPTY host resource directory {}: {error}",
            output_dir.display()
        )
    });
    fs::create_dir_all(dotnet_cli_home).unwrap_or_else(|error| {
        panic!(
            "Failed to create DOTNET_CLI_HOME directory {}: {error}",
            dotnet_cli_home.display()
        )
    });
    let local_app_data = dotnet_cli_home.join("localappdata");
    let app_data = dotnet_cli_home.join("appdata");
    fs::create_dir_all(&local_app_data).unwrap_or_else(|error| {
        panic!(
            "Failed to create LOCALAPPDATA directory {}: {error}",
            local_app_data.display()
        )
    });
    fs::create_dir_all(&app_data).unwrap_or_else(|error| {
        panic!(
            "Failed to create APPDATA directory {}: {error}",
            app_data.display()
        )
    });

    clean_generated_files(output_dir);

    let status = Command::new("dotnet")
        .env("DOTNET_SKIP_FIRST_TIME_EXPERIENCE", "1")
        .env("DOTNET_NOLOGO", "1")
        .env("DOTNET_CLI_HOME", dotnet_cli_home)
        .env("HOME", dotnet_cli_home)
        .env("USERPROFILE", dotnet_cli_home)
        .env("LOCALAPPDATA", &local_app_data)
        .env("APPDATA", &app_data)
        .arg("publish")
        .arg(helper_project)
        .arg("--configuration")
        .arg(configuration)
        .arg("--output")
        .arg(output_dir)
        .arg("--nologo")
        .arg("--verbosity")
        .arg("minimal")
        .status()
        .unwrap_or_else(|error| {
            panic!(
                "Failed to launch dotnet publish for {}: {error}",
                helper_project.display()
            )
        });

    if !status.success() {
        panic!(
            "dotnet publish failed for {} with exit code {:?}",
            helper_project.display(),
            status.code()
        );
    }

    let helper_executable = output_dir.join("TerminalWindowManager.ConPTYHost.exe");
    if !helper_executable.exists() {
        panic!(
            "ConPTY host publish completed but {} was not produced",
            helper_executable.display()
        );
    }
}

fn clean_generated_files(dir: &Path) {
    let entries = fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("Failed to enumerate {}: {error}", dir.display()));

    for entry in entries {
        let entry = entry.unwrap_or_else(|error| {
            panic!("Failed to enumerate an entry under {}: {error}", dir.display())
        });
        let path = entry.path();
        let should_keep = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == ".gitkeep" || name == "placeholder.txt");

        if should_keep {
            continue;
        }

        if path.is_dir() {
            fs::remove_dir_all(&path).unwrap_or_else(|error| {
                panic!("Failed to remove directory {}: {error}", path.display())
            });
        } else {
            fs::remove_file(&path)
                .unwrap_or_else(|error| panic!("Failed to remove file {}: {error}", path.display()));
        }
    }
}
