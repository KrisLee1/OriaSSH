import { expect, it } from "vitest";
import { completionPlan } from "./command-completion";
import {
  completionProfile,
  completionWord,
  insertCandidate,
} from "./shell-editor";

const bash = completionProfile(false, "bash", "linux-gnu");
const zsh = completionProfile(false, "zsh", "darwin25.0");
const powershell = completionProfile(true);

function plan(
  line: string,
  profile = bash,
  cursor = line.length,
  explicit = true,
) {
  return completionPlan(
    completionWord(line, cursor, profile.shell === "powershell"),
    profile,
    explicit,
  );
}

it("uses the session's shell and operating system for command names and syntax", () => {
  expect(plan("shopt", bash).names).toContain("shopt");
  expect(plan("shopt", zsh).names).toEqual([]);
  expect(plan("setop", zsh).names).toContain("setopt");
  expect(plan("systemc", bash).names).toContain("systemctl");
  expect(plan("systemc", zsh).names).toEqual([]);
  expect(plan("sw_ve", zsh).names).toContain("sw_vers");
  expect(plan("brew serv", zsh).names).toEqual(["services"]);
  expect(plan("get-ch", powershell).names).toContain("Get-ChildItem");
  expect(plan("winget up", powershell).names).toEqual(["upgrade"]);
  expect(plan("ls --co", bash).names).toEqual(["--color"]);
  expect(plan("ls --co", zsh).names).toEqual([]);
  expect(plan("ls -co", powershell).names).toEqual([]);
  expect(plan("ls -rec", powershell).names).toEqual(["-Recurse"]);
});

it("follows nested tools, leading options, assignments and shell wrappers", () => {
  expect(
    plan("sudo -u operator docker --context stage compose lo").names,
  ).toEqual(["logs"]);
  expect(plan("env LANG=C git -C ./repo sta").names).toEqual([
    "status",
    "stash",
  ]);
  expect(plan("python3 -m pip install --require").names).toEqual([
    "--requirement",
  ]);
  expect(plan("kubectl --namespace prod get po").names).toEqual(["pods"]);
  expect(plan("kubectl config view -o y").names).toEqual(["yaml"]);
  expect(plan("brew services res", zsh).names).toEqual(["restart"]);
  expect(plan("sudo -D ./ca").query).toBe("dirs");
  expect(plan("cd -- -r").query).toBe("dirs");
});

it("completes the active segment and only replaces the token under the caret", () => {
  const line = "echo 'a | b' 2>&1 | git sta --short";
  const { word, names } = plan(line, bash, line.indexOf(" --short"));
  expect(names[0]).toBe("status");
  expect(insertCandidate(line, word, names[0])).toEqual({
    line: "echo 'a | b' 2>&1 | git status --short",
    cursor: "echo 'a | b' 2>&1 | git status".length,
  });
  expect(plan("cat './a b' &&\npnpm ins").names).toContain("install");
  expect(plan("Get-Process | Select-Object -fi", powershell).names).toEqual([
    "-First",
  ]);
  expect(
    plan(
      "& 'C:\\Program Files\\Docker\\docker.exe' compose ps --fo",
      powershell,
    ).names,
  ).toEqual(["--format"]);
  expect(plan("echo ok > out").query).toBe("files");
  expect(plan("git status # docker ru").query).toBeUndefined();
});

it("prefers contextual values and quotes path arguments for the active shell", () => {
  const command = "git status --untracked-files=al";
  const result = plan(command);
  expect(result.names).toEqual(["all"]);
  expect(insertCandidate(command, result.word, "all", result.leader).line).toBe(
    "git status --untracked-files=all",
  );
  expect(result.query).toBeUndefined();
  const line = "npm --prefix=./sub-dir/F";
  const dir = plan(line);
  expect(dir.query).toBe("dirs");
  expect(insertCandidate(line, dir.word, "Folder A/", dir.leader).line).toBe(
    "npm --prefix=./sub-dir/Folder\\ A/",
  );
  const drive = "Set-Location -Path:C:fo";
  const argument = plan(drive, powershell);
  expect(argument.query).toBe("dirs");
  expect(
    insertCandidate(drive, argument.word, "folder name\\", argument.leader)
      .line,
  ).toBe("Set-Location -Path:'C:folder name\\'");
  expect(plan("get-childitem -ErrorAction sile", powershell).names).toEqual([
    "SilentlyContinue",
  ]);
  expect(plan("kubectl apply --filename ./ma").query).toBe("files");
  expect(plan("git commit -m text").query).toBeUndefined();
});

it("keeps normal shell lookup and skips it for catalog-only contexts", () => {
  expect(plan("unknown_alias").query).toBe("commands");
  expect(plan("unknown_alias data/lo").query).toBe("files");
  expect(plan("git sta", bash, 7, false).query).toBeUndefined();
  expect(plan("docker compose ").names.slice(0, 4)).toEqual([
    "up",
    "down",
    "ps",
    "logs",
  ]);
  expect(plan("docker compose ", bash, 15, false).names).toEqual([]);
  expect(plan("git status --short --sh").names).toEqual([]);
  expect(plan("", bash, 0, false).query).toBeUndefined();
});
