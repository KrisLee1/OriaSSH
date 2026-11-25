type OptionValue = "dir" | "path" | "value" | readonly string[];

type Option = { name: string; value?: OptionValue };

export type CommandSpec = {
  options: readonly Option[];
  children: ReadonlyMap<string, CommandSpec | undefined>;
  positional?: OptionValue;
};

const words = (value: string) => value.split(/\s+/u).filter(Boolean);

// Use =path, =dir, =value, or a pipe-separated list to describe an option's value.
function spec(
  options = "",
  commands = "",
  detail: Record<string, CommandSpec> = {},
  positional?: OptionValue,
): CommandSpec {
  return {
    options: words(options).map((entry): Option => {
      const [name, value] = entry.split("=");
      return {
        name,
        value:
          value === "dir" || value === "path" || value === "value"
            ? value
            : !value
              ? undefined
              : value.split("|"),
      };
    }),
    children: new Map([
      ...words(commands).map((name) => [name, undefined] as const),
      ...Object.entries(detail),
    ]),
    positional,
  };
}

const files = (options = "") => spec(options, "", {}, "path");
const dirs = (options = "") => spec(options, "", {}, "dir");
const logs = spec("-f --follow --since=value --tail=value -t --timestamps");
const compose = spec(
  "-f=path --file=path --project-directory=dir -p=value --project-name=value --profile=value --env-file=path",
  "up down ps logs exec run build pull restart stop start config ls images watch events top version",
  {
    up: spec(
      "-d --detach --build --no-build --force-recreate --no-deps --wait --scale=value",
    ),
    down: spec("--remove-orphans --volumes --timeout=value"),
    logs,
    ps: spec("-a --all -q --quiet --format=value"),
    build: spec("--no-cache --pull --progress=auto|plain|tty"),
    exec: spec("-T -it --user=value -u=value --workdir=dir -w=dir"),
    run: spec(
      "--rm -d --detach --no-deps -e=value --env=value -p=value --publish=value",
    ),
  },
);
const resources = words(
  "pods deployments services namespaces nodes configmaps secrets jobs cronjobs statefulsets daemonsets replicasets ingress events persistentvolumeclaims persistentvolumes serviceaccounts networkpolicies",
);
const kubectl = spec(
  "-n=value --namespace=value --context=value --kubeconfig=path --cluster=value -A --all-namespaces -v=value",
  "get describe logs exec apply delete create rollout scale set config port-forward top wait explain diff edit patch label annotate auth api-resources api-versions cluster-info version completion",
  {
    get: spec(
      "-o=wide|json|yaml|name|jsonpath -w --watch --show-labels -l=value --selector=value --field-selector=value --sort-by=value",
      "",
      {},
      resources,
    ),
    describe: spec("-l=value --selector=value", "", {}, resources),
    logs: spec(
      "-f --follow --previous -p -c=value --container=value --tail=value --since=value --timestamps",
    ),
    exec: spec("-i -t -it -c=value --container=value"),
    apply: spec(
      "-f=path --filename=path -k=dir --kustomize=dir --server-side --dry-run=none|client|server",
    ),
    delete: spec(
      "-f=path --filename=path --all --wait --grace-period=value -l=value --selector=value",
      "",
      {},
      resources,
    ),
    create: spec(
      "-f=path --filename=path --dry-run=none|client|server -o=json|yaml",
      "deployment service namespace configmap secret job cronjob ingress role rolebinding serviceaccount",
    ),
    rollout: spec("", "status restart history undo pause resume"),
    set: spec("", "image env resources selector serviceaccount subject"),
    config: spec(
      "",
      "current-context get-contexts use-context view set-context get-clusters get-users rename-context delete-context",
      { view: spec("--minify --flatten -o=json|yaml") },
    ),
    top: spec("", "node pod"),
    auth: spec("", "can-i reconcile whoami"),
    wait: spec(
      "--for=value --timeout=value -l=value --selector=value -f=path --filename=path",
      "",
      {},
      resources,
    ),
    completion: spec("", "bash zsh fish powershell"),
  },
);

const install = spec(
  "-D --save-dev -g --global --ignore-scripts --no-save -E --save-exact -w=value --workspace=value",
);
const npm = spec(
  "--prefix=dir -g --global -w=value --workspace=value --workspaces",
  "install i ci run exec test start stop restart init create uninstall remove update outdated list ls audit publish pack cache config view search link rebuild version whoami login logout",
  {
    install,
    i: install,
    ci: spec(
      "--ignore-scripts --omit=dev|optional|peer --include=dev|optional|peer",
    ),
    run: spec("--if-present --silent --parallel"),
    audit: spec("--json --omit=dev|optional|peer", "fix"),
    cache: spec("", "add clean ls verify"),
    config: spec("", "get set delete list edit fix"),
    list: spec("--depth=value --all --json"),
    exec: spec("--package=value -c=value --call=value -y --yes"),
  },
);
const pip = spec(
  "--version -V -v --verbose -q --quiet --python=path",
  "install uninstall list show freeze check download wheel cache config inspect index debug help",
  {
    install: spec(
      "-r=path --requirement=path -e=path --editable=path -c=path --constraint=path -U --upgrade --user --no-deps --no-cache-dir --dry-run --target=dir -t=dir --index-url=value --extra-index-url=value",
    ),
    list: spec("-o --outdated -u --uptodate --format=columns|freeze|json"),
    freeze: spec("--all --local --exclude=value"),
    cache: spec("", "dir info list remove purge"),
    config: spec("", "list edit get set unset debug"),
  },
);
const python = spec(
  "-B -E -I -O -P -S -u -V --version -c=value -X=value -m=pip|venv|http.server|unittest|pytest|timeit|json.tool|pydoc|compileall|ensurepip|uvicorn",
  "",
  {
    "-m pip": pip,
    "-m venv": dirs(
      "--system-site-packages --clear --upgrade --without-pip --upgrade-deps --prompt=value",
    ),
    "-m http.server": spec(
      "-b=value --bind=value -d=dir --directory=dir --protocol=value",
    ),
    "-m unittest": spec(
      "-v --verbose -q --quiet -f --failfast -k=value",
      "discover",
      { discover: spec("-s=dir -p=value -t=dir") },
    ),
  },
  "path",
);
const ssh = spec(
  "-4 -6 -A -a -C -F=path -i=path -J=value -L=value -R=value -D=value -o=value -p=value -l=value -N -T -t -v -vv -vvv",
);
const curl = spec(
  "-I --head -L --location -f --fail -s --silent -S --show-error -v --verbose -X=GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS --request=GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS -H=value --header=value -d=value --data=value --data-raw=value --data-binary=value -o=path --output=path -O --remote-name -u=value --user=value --connect-timeout=value --max-time=value --retry=value -x=value --proxy=value --compressed --http1.1 --http2 --json=value",
);

export const tools = new Map(
  Object.entries({
    git: spec(
      "-C=dir -c=value --git-dir=dir --work-tree=dir --no-pager --paginate --version --help",
      "status add commit diff log branch switch checkout restore fetch pull push merge rebase remote stash tag clone show reset reflog cherry-pick revert worktree submodule bisect clean grep describe blame config init rm mv ls-files rev-parse shortlog",
      {
        status: spec(
          "-s --short -b --branch --porcelain --ignored -u=value --untracked-files=all|normal|no",
        ),
        add: files(
          "-A --all -p --patch -u --update -n --dry-run -v --verbose -f --force",
        ),
        commit: spec(
          "-m=value --message=value -F=path --file=path -a --all --amend --no-edit -s --signoff -S --gpg-sign --dry-run -v --verbose",
        ),
        diff: files(
          "--staged --cached --stat --name-only --name-status --color=always|never|auto --word-diff --check --no-index",
        ),
        log: spec(
          "--oneline --graph --decorate --all --stat --patch --no-merges --first-parent --since=value --until=value --author=value --grep=value --max-count=value -n=value --format=value",
        ),
        branch: spec(
          "-a --all -r --remotes -v --verbose -d --delete -m --move --show-current --list --sort=value",
        ),
        switch: spec("-c=value --create=value --detach --track --guess"),
        checkout: files("-b=value -B=value --detach --ours --theirs --track"),
        restore: files(
          "--staged --worktree --source=value --ours --theirs -p --patch",
        ),
        fetch: spec("--all --prune --tags --no-tags --depth=value --dry-run"),
        pull: spec(
          "--rebase --no-rebase --ff-only --autostash --prune --verbose",
        ),
        push: spec(
          "-u --set-upstream --tags --follow-tags --dry-run --delete --force-with-lease",
        ),
        merge: spec(
          "--no-ff --ff-only --squash --abort --continue --no-commit",
        ),
        rebase: spec(
          "-i --interactive --onto=value --continue --abort --skip --autostash --rebase-merges",
        ),
        remote: spec(
          "-v --verbose",
          "add get-url set-url remove rename show prune update",
        ),
        stash: spec("", "push pop list show apply drop clear branch", {
          push: files(
            "-u --include-untracked -m=value --message=value -p --patch",
          ),
          show: spec("-p --patch --stat"),
        }),
        tag: spec(
          "-l --list -a --annotate -m=value --message=value -d --delete -s --sign --sort=value",
        ),
        clone: spec(
          "--depth=value -b=value --branch=value --recurse-submodules --single-branch --filter=value --bare --mirror",
        ),
        show: spec("--stat --name-only --pretty=value"),
        config: spec(
          "--global --local --system --worktree --list -l --get --add --unset --file=path --show-origin",
        ),
        worktree: spec("", "add list lock move prune remove repair unlock"),
        submodule: spec("", "add init update status sync foreach deinit", {
          update: spec(
            "--init --recursive --remote --checkout --merge --rebase",
          ),
        }),
        bisect: spec("", "start good bad reset skip log run replay"),
        reset: files("--soft --mixed --hard --merge --keep"),
        clean: files("-n --dry-run -d -i --interactive -x -X"),
        init: dirs("--initial-branch=value -b=value --bare --template=dir"),
      },
    ),
    gh: spec(
      "-R=value --repo=value --hostname=value",
      "pr issue repo release workflow run auth api gist search status browse ssh-key completion",
      {
        pr: spec(
          "-R=value --repo=value",
          "list view status checks diff checkout create merge review comment edit ready close reopen",
          {
            list: spec(
              "-s=open|closed|merged|all --state=open|closed|merged|all -L=value --limit=value --author=value --json=value --web",
            ),
            view: spec("--web --comments --json=value"),
          },
        ),
        issue: spec(
          "-R=value --repo=value",
          "list view status create comment edit close reopen",
        ),
        auth: spec("", "login logout status refresh switch setup-git token"),
        repo: spec("", "clone create view list fork sync"),
        workflow: spec("", "list view run enable disable"),
        run: spec("", "list view watch rerun cancel download"),
      },
    ),
    docker: spec(
      "--context=value --host=value -H=value --config=dir -D --debug --log-level=debug|info|warn|error|fatal",
      "run ps images build pull push exec logs stop start restart inspect rm rmi tag version info compose container image volume network context system stats cp login logout save load buildx",
      {
        compose,
        run: spec(
          "-d --detach -i --interactive -t --tty -it --rm -p=value --publish=value --name=value -v=value --volume=value --mount=value -e=value --env=value --env-file=path -w=dir --workdir=dir --network=value --platform=value --entrypoint=value",
        ),
        ps: spec(
          "-a --all -q --quiet --no-trunc -f=value --filter=value --format=value",
        ),
        images: spec("-a --all -q --quiet --digests --format=value"),
        logs,
        exec: spec(
          "-i --interactive -t --tty -it -d --detach -e=value --env=value -u=value --user=value -w=dir --workdir=dir",
        ),
        build: dirs(
          "-t=value --tag=value -f=path --file=path --build-arg=value --no-cache --pull --platform=value --target=value --progress=auto|plain|tty",
        ),
        buildx: spec("", "build bake create inspect ls use version", {
          build: dirs(
            "-t=value --tag=value -f=path --file=path --platform=value --push --load --no-cache --progress=auto|plain|tty",
          ),
        }),
        container: spec("", "ls run exec logs inspect rm start stop stats", {
          logs,
        }),
        image: spec(
          "",
          "ls build pull push inspect history prune rm save load tag",
        ),
        volume: spec("", "ls create inspect rm prune"),
        network: spec("", "ls create inspect connect disconnect rm prune"),
        context: spec("", "ls use inspect create show"),
        system: spec("", "df events info prune"),
      },
    ),
    "docker-compose": compose,
    podman: spec(
      "--connection=value --log-level=debug|info|warn|error",
      "run ps images build pull push exec logs pod compose container image volume network system inspect rm start stop",
      { compose, logs, pod: spec("", "create list inspect start stop rm") },
    ),
    kubectl,
    oc: kubectl,
    helm: spec(
      "-n=value --namespace=value --kube-context=value --kubeconfig=path --debug",
      "install upgrade uninstall list status show repo search template pull package dependency lint history rollback test version",
      {
        install: spec(
          "-f=path --values=path --set=value --set-string=value --dry-run --wait --create-namespace --timeout=value",
        ),
        upgrade: spec(
          "-i --install -f=path --values=path --set=value --dry-run --wait --create-namespace --timeout=value",
        ),
        repo: spec("", "add list update remove index"),
        show: spec("", "all chart readme values"),
        dependency: spec("", "build list update"),
      },
    ),
    npm,
    npx: spec(
      "-y --yes -p=value --package=value --no-install --offline --prefer-offline",
    ),
    pnpm: spec(
      "-C=dir --dir=dir --filter=value -r --recursive",
      "add install i run exec dlx remove update list outdated audit create init test build start setup store config fetch import why link deploy publish",
      {
        add: spec(
          "-D --save-dev -P --save-prod -O --save-optional -w --workspace-root -g --global -E --save-exact",
        ),
        install: spec(
          "--frozen-lockfile --offline --prefer-offline --prod --ignore-scripts --lockfile-only",
        ),
        run: spec("--if-present --parallel --stream"),
        store: spec("", "path status prune add"),
        config: spec("", "get set delete list"),
      },
    ),
    yarn: spec(
      "--cwd=dir",
      "add install run dlx remove upgrade up why info workspaces cache config set npm init test build start",
      {
        add: spec("-D --dev -E --exact -P --peer"),
        install: spec(
          "--immutable --immutable-cache --check-cache --frozen-lockfile",
        ),
        workspaces: spec("", "list foreach focus"),
        cache: spec("", "clean"),
        config: spec("", "get set unset"),
      },
    ),
    bun: spec(
      "--cwd=dir",
      "run test install add remove update build create init x outdated link pm",
      {
        install: spec(
          "--frozen-lockfile --production --ignore-scripts --lockfile-only",
        ),
        run: spec("--watch --hot --silent"),
        build: files(
          "--target=bun|node|browser --outdir=dir --minify --sourcemap=inline|external|linked",
        ),
      },
    ),
    node: files(
      "--version -v --help --watch --test --check -c -e=value --eval=value --inspect --inspect-brk --env-file=path --require=path -r=path",
    ),
    deno: spec(
      "",
      "run task test bench fmt lint check compile install add remove info doc repl upgrade serve",
      {
        run: files(
          "--allow-read --allow-write --allow-net --allow-env --allow-run --watch --no-prompt",
        ),
      },
    ),
    python,
    python3: python,
    py: python,
    pip,
    pip3: pip,
    pipx: spec(
      "",
      "install inject run runpip uninstall reinstall upgrade upgrade-all list ensurepath completions",
    ),
    uv: spec(
      "--directory=dir --project=dir --no-cache --offline --verbose",
      "run sync lock add remove pip tool venv python init build publish export cache tree",
      {
        pip,
        venv: dirs("--python=value -p=value --seed --system-site-packages"),
        sync: spec("--locked --frozen --no-dev --extra=value --all-extras"),
        python: spec("", "list install find pin uninstall dir"),
        tool: spec("", "run install list upgrade uninstall update-shell"),
      },
    ),
    conda: spec(
      "-n=value --name=value -p=dir --prefix=dir",
      "activate deactivate create install update remove list env config clean info search run init",
      {
        env: spec("", "list create export remove update config"),
        create: spec(
          "-n=value --name=value -p=dir --prefix=dir -c=value --channel=value -f=path --file=path --dry-run -y --yes",
        ),
        install: spec(
          "-n=value --name=value -c=value --channel=value -f=path --file=path --dry-run -y --yes",
        ),
      },
    ),
    poetry: spec(
      "-C=dir --directory=dir --project=dir -q --quiet -v --verbose",
      "add install lock sync run shell env build publish show update remove init new check config export",
      {
        env: spec("", "use info list remove"),
        install: spec(
          "--no-root --with=value --without=value --only=value --dry-run",
        ),
      },
    ),
    pytest: files(
      "-v --verbose -q --quiet -x --exitfirst -k=value -m=value --maxfail=value --lf --last-failed --ff --failed-first --collect-only --fixtures --tb=auto|long|short|line|native|no -s",
    ),
    cargo: spec(
      "--version -V --list -v --verbose -q --quiet --locked --offline --frozen",
      "build check run test clippy fmt add remove update install uninstall new init clean doc bench search tree metadata publish package fetch fix",
      {
        build: spec(
          "-r --release --target=value --profile=value --manifest-path=path -p=value --package=value --workspace --all-features --no-default-features --features=value",
        ),
        run: spec(
          "-r --release --bin=value --example=value --manifest-path=path -p=value --package=value --features=value",
        ),
        test: spec(
          "-r --release --lib --bin=value --test=value --doc --workspace --all-features --no-run --manifest-path=path",
        ),
        fmt: spec("--all --check --manifest-path=path"),
        clippy: spec(
          "--all-targets --all-features --workspace --fix --manifest-path=path",
        ),
      },
    ),
    rustup: spec(
      "",
      "show update default toolchain target component override run which doc self set",
      {
        toolchain: spec("", "list install uninstall link"),
        target: spec("", "list add remove"),
        component: spec("", "list add remove"),
      },
    ),
    go: spec(
      "",
      "bug build clean doc env fix fmt generate get install list mod run test tool version vet work",
      {
        test: spec(
          "-v -race -cover -coverprofile=path -run=value -count=value -timeout=value -bench=value",
        ),
        build: spec("-o=path -v -race -trimpath -tags=value -ldflags=value"),
        mod: spec("", "download edit graph init tidy vendor verify why"),
        work: spec("", "edit init sync use vendor"),
      },
    ),
    dotnet: spec(
      "--info --list-sdks --list-runtimes --version",
      "new restore build run test publish clean pack add remove list tool nuget sln watch format workload ef",
      {
        build: files(
          "-c=Debug|Release --configuration=Debug|Release -o=dir --output=dir --no-restore -f=value --framework=value",
        ),
        run: spec(
          "--project=path -c=Debug|Release --configuration=Debug|Release --no-build --no-restore",
        ),
        tool: spec("", "install update uninstall list restore run search"),
        nuget: spec("", "add locals list push remove update"),
      },
    ),
    mvn: spec(
      "-q --quiet -B --batch-mode -U --update-snapshots -o --offline -f=path --file=path -P=value -DskipTests",
      "clean validate compile test package verify install deploy site dependency:tree help:effective-pom spring-boot:run",
    ),
    gradle: spec(
      "-p=dir --project-dir=dir -q --quiet -i --info --debug --offline --stacktrace --scan -x=value --exclude-task=value",
      "tasks projects dependencies clean assemble build check test run installDist publish wrapper",
    ),
    cmake: spec(
      "-S=dir -B=dir -G=value --preset=value --build=dir --install=dir --target=value --config=Debug|Release|RelWithDebInfo|MinSizeRel --parallel=value --fresh --version --help",
    ),
    ctest: spec(
      "--test-dir=dir --output-on-failure -V --verbose -R=value -E=value -L=value -j=value -C=Debug|Release --rerun-failed",
    ),
    make: spec(
      "-C=dir --directory=dir -f=path --file=path -j=value --jobs=value -n --dry-run -k --keep-going -s --silent",
      "all build clean install test check help",
    ),
    ninja: spec(
      "-C=dir -f=path -j=value -n -v -t=targets|commands|graph|clean|query",
      "all clean install test",
    ),
    terraform: spec(
      "-chdir=dir -help -version",
      "init validate plan apply destroy fmt output show state import workspace providers console graph refresh version",
      {
        plan: spec(
          "-out=path -var=value -var-file=path -target=value -refresh-only -destroy -detailed-exitcode",
        ),
        apply: spec(
          "-var=value -var-file=path -target=value -refresh-only -auto-approve",
        ),
        init: spec("-upgrade -reconfigure -backend-config=path"),
        state: spec("", "list show mv rm pull push"),
        workspace: spec("", "list new select show delete"),
      },
    ),
    ansible: spec(
      "-i=path --inventory=path -m=value --module-name=value -a=value --args=value --limit=value --check --diff -b --become -u=value --user=value -v --verbose",
    ),
    "ansible-playbook": files(
      "-i=path --inventory=path --limit=value --tags=value --skip-tags=value --check --diff --syntax-check --list-tasks --extra-vars=value -b --become -v --verbose",
    ),
    aws: spec(
      "--profile=value --region=value --output=json|text|table|yaml --no-cli-pager --query=value",
      "s3 s3api ec2 sts iam configure eks ecr ecs lambda cloudformation logs ssm rds dynamodb",
      {
        s3: spec(
          "--recursive --dryrun --exclude=value --include=value",
          "ls cp mv rm sync mb rb presign",
        ),
        sts: spec("", "get-caller-identity assume-role"),
        configure: spec("", "list list-profiles get set sso"),
        logs: spec(
          "",
          "tail filter-log-events describe-log-groups get-log-events",
        ),
        eks: spec("", "list-clusters describe-cluster update-kubeconfig"),
      },
    ),
    gcloud: spec(
      "--project=value --configuration=value --format=json|yaml|table|value --quiet",
      "auth config compute container storage projects run functions iam sql logging components",
      {
        auth: spec("", "login list revoke application-default"),
        config: spec("", "list set get-value configurations"),
        compute: spec(
          "",
          "instances disks networks firewall-rules ssh scp zones regions",
          { instances: spec("", "list describe create start stop delete") },
        ),
        container: spec("", "clusters images", {
          clusters: spec("", "list describe get-credentials create delete"),
        }),
        storage: spec("", "ls cp rsync mv rm buckets"),
      },
    ),
    az: spec(
      "--subscription=value --output=json|jsonc|table|tsv|yaml --query=value --verbose --debug",
      "account login logout group vm aks acr storage network webapp functionapp resource deployment version",
      {
        account: spec("", "show list set get-access-token"),
        group: spec("", "list show create delete"),
        vm: spec("", "list show start stop restart deallocate"),
        aks: spec("", "list show get-credentials start stop"),
        storage: spec("", "account blob container file"),
      },
    ),
    ssh,
    scp: files(
      "-3 -4 -6 -C -F=path -i=path -J=value -P=value -p -r -v -o=value -O",
    ),
    sftp: spec(
      "-4 -6 -C -b=path -F=path -i=path -J=value -P=value -R=value -o=value",
    ),
    "ssh-keygen": spec(
      "-t=ed25519|rsa|ecdsa -b=value -C=value -f=path -l -p -y -F=value -R=value",
    ),
    curl,
    wget: spec(
      "-c --continue -O=path --output-document=path -P=dir --directory-prefix=dir -q --quiet -S --server-response --spider --timeout=value --tries=value --header=value",
    ),
    rg: spec(
      "-i --ignore-case -S --smart-case -s --case-sensitive -n --line-number -F --fixed-strings -w --word-regexp -e=value --regexp=value -g=value --glob=value -t=value --type=value -T=value --type-not=value -l --files-with-matches --files --hidden --no-ignore -C=value -A=value -B=value --json --color=always|ansi|auto|never",
    ),
    fd: spec(
      "-H --hidden -I --no-ignore -e=value --extension=value -t=file|directory|symlink|empty|executable --type=file|directory|symlink|empty|executable -d=value --max-depth=value -E=value --exclude=value --base-directory=dir -a --absolute-path --color=always|auto|never",
    ),
    jq: files(
      "-r --raw-output -c --compact-output -s --slurp -n --null-input -e --exit-status -S --sort-keys -f=path --from-file=path --arg=value --argjson=value --slurpfile=value --rawfile=value",
    ),
    yq: spec(
      "-i --inplace -o=yaml|json|xml|props|csv|tsv --output-format=yaml|json|xml|props|csv|tsv -P --prettyPrint -r --unwrapScalar",
      "eval eval-all e ea",
    ),
    ffmpeg: spec(
      "-i=path -f=value -c:v=value -c:a=value -map=value -ss=value -t=value -vf=value -af=value -b:v=value -r=value -an -vn -n -y -hide_banner -loglevel=quiet|error|warning|info|verbose|debug",
    ),
    ffprobe: files(
      "-v=quiet|error|warning|info -show_streams -show_format -select_streams=value -of=json|csv|default",
    ),
    sqlite3: files(
      "-csv -json -header -readonly -column -line -separator=value -init=path",
    ),
    psql: files(
      "-h=value --host=value -p=value --port=value -U=value --username=value -d=value --dbname=value -f=path --file=path -c=value --command=value -v=value --set=value -X --no-psqlrc -t --tuples-only",
    ),
    mysql: spec(
      "-h=value --host=value -P=value --port=value -u=value --user=value -p --password -D=value --database=value -e=value --execute=value --protocol=TCP|SOCKET|PIPE|MEMORY --batch",
    ),
    "redis-cli": spec(
      "-h=value -p=value -n=value -u=value --tls --raw --json --scan --pattern=value -c -r=value -i=value",
      "PING INFO GET SET EXISTS TTL SCAN HGET HGETALL LRANGE SMEMBERS ZRANGE DBSIZE SELECT",
    ),
    openssl: spec(
      "",
      "version rand dgst enc x509 req genpkey pkey verify s_client pkcs12",
      {
        x509: spec(
          "-in=path -out=path -text -noout -subject -issuer -dates -fingerprint -checkend=value",
        ),
        s_client: spec(
          "-connect=value -servername=value -showcerts -CAfile=path -verify_return_error",
        ),
        dgst: files("-sha256 -sha512 -sha384 -sha1 -hex -binary"),
        req: spec(
          "-in=path -out=path -new -x509 -key=path -text -noout -days=value",
        ),
      },
    ),
    bat: files(
      "--plain -p -n --number -l=value --language=value --style=value --color=always|auto|never --paging=always|auto|never --list-languages",
    ),
    eza: files(
      "-l --long -a --all -T --tree -L=value --level=value --git --sort=value --color=always|auto|never",
    ),
    fzf: spec(
      "-m --multi -e --exact -q=value --query=value --filter=value --prompt=value --preview=value --height=value --layout=default|reverse|reverse-list",
    ),
    tmux: spec(
      "-f=path -L=value -S=path",
      "new-session attach-session list-sessions kill-session new-window split-window capture-pane list-panes send-keys",
      {
        "new-session": spec("-s=value -d -c=dir"),
        "attach-session": spec("-t=value -r"),
        "split-window": spec("-h -v -c=dir -p=value"),
        "capture-pane": spec("-p -S=value -E=value"),
      },
    ),
    rsync: files(
      "-a --archive -v --verbose -z --compress -h --human-readable -r --recursive -n --dry-run -P --partial --progress --delete --exclude=value --exclude-from=path --include=value -e=value --itemize-changes --stats",
    ),
    tar: files(
      "-c -x -t -v -z -j -J -f=path -C=dir -czf=path -xzf=path -tf=path",
    ),
    zip: files("-r -q -v -e -x=value -i=value -j"),
    unzip: files("-l -t -q -o -n -d=dir -j"),
    "7z": spec("", "a x e l t u d", {
      a: files("-t=7z|zip|tar -mx=value -mmt=value"),
      x: files("-o=dir -y -aoa -aos"),
      e: files("-o=dir -y"),
    }),
    "7zz": spec("", "a x e l t u d"),
    http: spec(
      "--json --form --multipart --follow --download --output=path --print=value --auth=value --timeout=value",
      "GET POST PUT PATCH DELETE HEAD OPTIONS",
    ),
    just: spec(
      "--list -l --summary --show=value --dry-run --justfile=path -f=path --working-directory=dir -d=dir --evaluate",
    ),
    task: spec(
      "--list -l --list-all --dry --summary --dir=dir --taskfile=path --verbose --silent",
    ),
    code: files(
      "--diff -d --goto -g --new-window -n --reuse-window -r --wait -w --list-extensions --install-extension=value",
    ),
    vim: files("-R -u=path -o -O -p -d -n"),
    nvim: files("-R -u=path -o -O -p -d --headless --clean"),
    nano: files("-l --linenumbers -m --mouse -v --view -w --nowrap"),
    less: files("-N -S -R -i -F -X"),
  }),
);

const posix = {
  cd: dirs("-L -P"),
  pushd: dirs("-n"),
  popd: spec("-n"),
  ls: files("-l -a -A -h -R -t -r -d -i -S -1 -F"),
  cp: files("-R -r -p -i -f -v"),
  mv: files("-i -f -n -v"),
  rm: files("-i -f -R -r -d -v"),
  mkdir: dirs("-p -m=value -v"),
  rmdir: dirs("-p"),
  touch: files("-a -m -c -r=path -t=value"),
  cat: files("-n -b -s -v -e -t"),
  head: files("-n=value -c=value"),
  tail: files("-n=value -c=value -f -F"),
  grep: files(
    "-i --ignore-case -v --invert-match -n --line-number -F --fixed-strings -E --extended-regexp -w --word-regexp -e=value --regexp=value -f=path --file=path -A=value -B=value -C=value -l --files-with-matches -c --count -r --recursive",
  ),
  find: dirs(
    "-name=value -iname=value -path=value -type=f|d|l|b|c|p|s -maxdepth=value -mindepth=value -mtime=value -size=value -print -print0 -exec=value",
  ),
  sed: files("-n -E -e=value -f=path"),
  awk: files("-F=value -v=value -f=path"),
  sort: files("-n -r -u -k=value -t=value -o=path"),
  uniq: files("-c -d -u -i"),
  du: dirs("-h -s -a -k -m"),
  df: files("-h -k -a -P"),
  ps: spec("-A -e -f -o=value -p=value -u=value"),
  chmod: files("-R -v"),
  chown: files("-R -h -v"),
  ln: files("-s -f -n -v"),
  xargs: spec("-0 -I=value -n=value -P=value -L=value"),
  sudo: spec(
    "-u=value --user=value -g=value --group=value -D=dir --chdir=dir -E --preserve-env -n -H -i -s -v -l",
  ),
  env: spec(
    "-i --ignore-environment -u=value --unset=value -C=dir --chdir=dir",
  ),
  nice: spec("-n=value"),
  command: spec("-p -v -V"),
  export: spec("-p"),
  read: spec("-r"),
  set: spec("-o=value +o=value"),
  unset: spec("-f -v"),
  source: files(),
  ".": files(),
  printf: spec(),
  echo: spec("-n"),
  pwd: spec("-L -P"),
  whoami: spec(),
  id: spec("-u -g -G -n"),
  uname: spec("-a -s -n -r -m -v"),
  date: spec("-u"),
  wc: files("-l -w -c -m"),
  tee: files("-a -i"),
  diff: files("-u -r -q -w -b -U=value"),
  file: files("-b -i -L -h"),
  which: spec("-a"),
  type: spec("-a"),
  man: spec("-k -f -w -M=dir"),
  top: spec(),
  kill: spec("-s=TERM|INT|HUP|KILL|STOP|CONT -l"),
  history: spec(),
  alias: spec(),
  unalias: spec("-a"),
  jobs: spec("-l -p"),
  fg: spec(),
  bg: spec(),
  exit: spec(),
  clear: spec(),
};

const bash = {
  bash: files(
    "--login -l -i -c=value -n -x --norc --noprofile --rcfile=path --posix",
  ),
  shopt: spec(
    "-s -u -q -p -o",
    "",
    {},
    words(
      "autocd cdspell checkwinsize dotglob extglob failglob globstar histappend nocaseglob nullglob",
    ),
  ),
  compgen: spec(
    "-A=alias|builtin|command|directory|file|function|variable -a -b -c -d -f -v",
  ),
  complete: spec("-F=value -C=value -W=value -o=value -A=value -r -p"),
  bind: spec("-l -p -P -f=path -m=value -x=value"),
  declare: spec("-a -A -f -F -i -p -r -x"),
  help: spec("-d -m -s"),
};

const zsh = {
  zsh: files("-l -i -c=value -f -n -x"),
  autoload: spec("-U -z -X -w"),
  zmodload: spec(
    "-a -b -e -F -i -L -u",
    "",
    {},
    words(
      "zsh/complist zsh/parameter zsh/mathfunc zsh/stat zsh/zpty zsh/zutil",
    ),
  ),
  zstyle: spec("-L -d -e -s -a -b -t"),
  setopt: spec(
    "",
    "",
    {},
    words(
      "autocd extendedglob globdots histignoredups sharehistory interactivecomments nocaseglob nullglob promptsubst",
    ),
  ),
  unsetopt: spec(),
  typeset: spec("-a -A -f -g -p -r -x"),
  compinit: spec("-C -D -i -u -d=path"),
  compdef: spec("-d"),
  whence: spec("-a -v -p -w"),
};

const linux = {
  systemctl: spec(
    "--user --system --no-pager --no-legend --now --all -a --type=service|socket|timer|target|mount --state=active|inactive|failed|running|exited --host=value -H=value",
    "status list-units list-unit-files list-timers start stop restart reload reload-or-restart enable disable is-active is-enabled is-failed daemon-reload show cat edit mask unmask reset-failed get-default set-default",
  ),
  journalctl: spec(
    "-u=value --unit=value --user -b --boot -f --follow -n=value --lines=value -e --pager-end --since=value --until=value -k --dmesg -p=emerg|alert|crit|err|warning|notice|info|debug --priority=emerg|alert|crit|err|warning|notice|info|debug -o=short|short-iso|cat|json|json-pretty --output=short|short-iso|cat|json|json-pretty --no-pager --disk-usage --list-boots",
  ),
  apt: spec(
    "-y --assume-yes -q -s --simulate",
    "update upgrade full-upgrade install reinstall remove purge autoremove search show list edit-sources policy",
  ),
  "apt-get": spec(
    "-y --assume-yes -q -s --simulate --no-install-recommends",
    "update upgrade dist-upgrade install reinstall remove purge autoremove clean autoclean check download",
  ),
  "apt-cache": spec("", "search show policy depends rdepends pkgnames"),
  dnf: spec(
    "-y --assumeyes -q --refresh --enablerepo=value --disablerepo=value",
    "install remove upgrade update search info list history distro-sync clean repolist",
  ),
  yum: spec(
    "-y -q",
    "install remove update search info list history clean repolist",
  ),
  pacman: spec(
    "-S -Sy -Syu -Ss -Si -Q -Qi -Qe -Ql -R -Rs -U=path --needed --noconfirm",
  ),
  zypper: spec(
    "-n --non-interactive",
    "refresh install remove update dup search info repos addrepo",
  ),
  apk: spec(
    "-q --no-cache --virtual=value --repository=value",
    "add del update upgrade search info list fix cache",
  ),
  dpkg: spec(
    "-i=path --install=path -r=value --remove=value -P=value --purge=value -l --list -L=value --listfiles=value -s=value --status=value -S=value --search=value",
  ),
  rpm: spec(
    "-q -qa -qi -ql -qf=path -i=path -U=path -e=value --query --verify",
  ),
  ip: spec(
    "-4 -6 -br -j -details",
    "address addr link route neigh rule netns monitor",
    {
      address: spec("", "show add del flush"),
      link: spec("", "show set add del"),
      route: spec("", "show get add del replace"),
      netns: spec("", "list add delete exec"),
    },
  ),
  ss: spec(
    "-l --listening -a --all -n --numeric -t --tcp -u --udp -p --processes -x --unix -s --summary -4 -6",
  ),
  lsblk: spec(
    "-f --fs -o=value --output=value -J --json -d --nodeps -p --paths -a --all",
  ),
  free: spec(
    "-h --human -m --mebi -g --gibi -w --wide -s=value --seconds=value",
  ),
  uname: posix.uname,
  hostnamectl: spec("", "status hostname set-hostname"),
  timedatectl: spec("", "status list-timezones set-timezone set-ntp"),
  nmcli: spec(
    "-t --terse -f=value --fields=value",
    "general networking radio connection device",
    {
      device: spec("", "status show wifi connect disconnect", {
        wifi: spec("", "list connect hotspot rescan"),
      }),
      connection: spec("", "show up down add modify delete reload"),
    },
  ),
  "xdg-open": files(),
  lsof: spec("-i -n -P -p=value -u=value +D=dir"),
  "update-alternatives": spec(
    "--display=value --list=value --config=value --query=value",
  ),
  ls: files(
    "-l -a -A -h -R -t -r -d -i -S -1 -F --color=always|auto|never --group-directories-first --sort=name|size|time|version|extension|none --time-style=value",
  ),
  sed: files("-n -E -r -i -e=value -f=path --in-place"),
  df: files("-h -k -a -P -T --output=value"),
  du: dirs("-h -s -a -k -m -d=value --max-depth=value --exclude=value"),
};

const macos = {
  brew: spec(
    "",
    "install uninstall upgrade update list search info doctor services bundle cleanup outdated leaves tap untap config deps autoremove pin unpin fetch",
    {
      install: spec("--cask --formula --dry-run --build-from-source"),
      list: spec("--cask --formula --versions"),
      info: spec("--cask --formula --json=v1|v2"),
      services: spec("", "list info run start stop kill restart cleanup"),
      bundle: spec(
        "--file=path --no-upgrade --global",
        "install dump check cleanup list exec",
      ),
    },
  ),
  port: spec(
    "-v -q -N",
    "search info install uninstall upgrade selfupdate sync installed outdated variants contents select",
  ),
  launchctl: spec(
    "",
    "list print bootstrap bootout kickstart enable disable blame print-disabled",
    { kickstart: spec("-k -p"), bootstrap: files(), bootout: files() },
  ),
  open: files("-a=value -b=value -e -t -f -R -W -n -g -j -F --args"),
  defaults: spec("", "read read-type write rename delete domains find help"),
  xcodebuild: files(
    "-project=path -workspace=path -scheme=value -configuration=Debug|Release -destination=value -derivedDataPath=dir -sdk=value -showBuildSettings -list",
  ),
  xcrun: spec(
    "--sdk=value --toolchain=value --find=value --run=value --show-sdk-path --show-sdk-version",
    "simctl devicectl swift clang",
  ),
  sw_vers: spec("-productName -productVersion -buildVersion"),
  softwareupdate: spec(
    "-l --list -i --install -a --all --list-full-installers",
  ),
  diskutil: spec(
    "",
    "list info mount unmount eject verifyDisk verifyVolume apfs",
    { apfs: spec("", "list listSnapshots") },
  ),
  plutil: files(
    "-lint -p -convert=xml1|binary1|json -o=path -extract=value -replace=value",
  ),
  pbcopy: spec("-pboard=general|ruler|find|font"),
  pbpaste: spec("-Prefer=txt|rtf|ps -pboard=general|ruler|find|font"),
  caffeinate: spec("-d -i -m -s -u -t=value -w=value"),
  lsof: linux.lsof,
  networksetup: spec(
    "-listallhardwareports -listallnetworkservices -getinfo=value -getdnsservers=value -getairportnetwork=value",
  ),
  mdls: files("-name=value -raw"),
  mdfind: spec("-name=value -onlyin=dir -live -count"),
  sed: files("-n -E -i=value -e=value -f=path"),
};

const bsd = {
  pkg: spec(
    "-j=value -c=dir",
    "install delete update upgrade search info audit autoremove clean which",
  ),
  service: spec(
    "-e -l -R",
    "",
    {},
    words("status start stop restart enable disable"),
  ),
  sysrc: spec("-a -A -n -f=path -x"),
  sockstat: spec("-4 -6 -l -c -p=value"),
  sysctl: spec("-a -n -w -d"),
};

const psParameters =
  "-Verbose -Debug -ErrorAction=Continue|Stop|SilentlyContinue|Inquire|Ignore -WarningAction=Continue|Stop|SilentlyContinue|Inquire|Ignore -InformationAction=Continue|Stop|SilentlyContinue|Inquire|Ignore -ErrorVariable=value -OutVariable=value -OutBuffer=value -PipelineVariable=value";
const psPath =
  "-Path=path -LiteralPath=path -Filter=value -Include=value -Exclude=value -Force";
const psSelect =
  "-Property=value -First=value -Last=value -Skip=value -Unique -ExpandProperty=value -ExcludeProperty=value";
const powershell = {
  "Get-ChildItem": files(
    psPath +
      " -Recurse -Depth=value -Directory -File -Name -Hidden -ReadOnly -System -Attributes=value",
  ),
  "Set-Location": dirs("-Path=dir -LiteralPath=dir -PassThru -StackName=value"),
  "Get-Location": spec(
    "-PSProvider=value -PSDrive=value -Stack -StackName=value",
  ),
  "Push-Location": dirs(
    "-Path=dir -LiteralPath=dir -StackName=value -PassThru",
  ),
  "Pop-Location": spec("-StackName=value -PassThru"),
  "Get-Content": files(
    psPath +
      " -TotalCount=value -Head=value -Tail=value -Wait -Raw -Encoding=utf8|utf8NoBOM|utf8BOM|ascii|unicode|default|oem -ReadCount=value",
  ),
  "Set-Content": files(
    psPath +
      " -Value=value -Encoding=utf8|utf8NoBOM|utf8BOM|ascii|unicode|default|oem -NoNewline -WhatIf -Confirm",
  ),
  "Add-Content": files(
    psPath + " -Value=value -Encoding=value -NoNewline -WhatIf -Confirm",
  ),
  "Clear-Content": files(psPath + " -WhatIf -Confirm"),
  "Get-Item": files(psPath + " -Stream=value"),
  "Get-ItemProperty": files(psPath + " -Name=value"),
  "Copy-Item": files(
    psPath +
      " -Destination=path -Recurse -Container -PassThru -WhatIf -Confirm",
  ),
  "Move-Item": files(psPath + " -Destination=path -PassThru -WhatIf -Confirm"),
  "Remove-Item": files(psPath + " -Recurse -WhatIf -Confirm"),
  "Rename-Item": files(
    "-Path=path -LiteralPath=path -NewName=value -Force -PassThru -WhatIf -Confirm",
  ),
  "New-Item": files(
    "-Path=path -Name=value -ItemType=File|Directory|SymbolicLink|Junction|HardLink -Value=value -Force -WhatIf -Confirm",
  ),
  "Test-Path": files(
    psPath +
      " -PathType=Any|Container|Leaf -IsValid -NewerThan=value -OlderThan=value",
  ),
  "Resolve-Path": files("-Path=path -LiteralPath=path -Relative"),
  "Join-Path": dirs(
    "-Path=dir -ChildPath=path -AdditionalChildPath=path -Resolve",
  ),
  "Split-Path": files(
    "-Path=path -LiteralPath=path -Parent -Leaf -Qualifier -NoQualifier -IsAbsolute -Resolve",
  ),
  "Get-Command": spec(
    "-Name=value -Verb=value -Noun=value -Module=value -CommandType=Alias|Function|Filter|Cmdlet|ExternalScript|Application|Script|All -All -ListImported -Syntax -ShowCommandInfo",
  ),
  "Get-Help": spec(
    "-Name=value -Full -Detailed -Examples -Online -Parameter=value -Category=value",
  ),
  "Get-History": spec("-Id=value -Count=value"),
  "Invoke-History": spec("-Id=value -WhatIf -Confirm"),
  "Get-Process": spec(
    "-Name=value -Id=value -FileVersionInfo -Module -IncludeUserName",
  ),
  "Start-Process": files(
    "-FilePath=path -ArgumentList=value -WorkingDirectory=dir -Verb=value -Wait -PassThru -NoNewWindow -WindowStyle=Normal|Hidden|Minimized|Maximized -RedirectStandardOutput=path -RedirectStandardError=path -RedirectStandardInput=path",
  ),
  "Stop-Process": spec(
    "-Name=value -Id=value -Force -PassThru -WhatIf -Confirm",
  ),
  "Get-Service": spec(
    "-Name=value -DisplayName=value -Include=value -Exclude=value -DependentServices -RequiredServices",
  ),
  "Start-Service": spec(
    "-Name=value -DisplayName=value -PassThru -WhatIf -Confirm",
  ),
  "Stop-Service": spec(
    "-Name=value -DisplayName=value -Force -PassThru -WhatIf -Confirm",
  ),
  "Restart-Service": spec(
    "-Name=value -DisplayName=value -Force -PassThru -WhatIf -Confirm",
  ),
  "Get-WinEvent": files(
    "-LogName=value -ProviderName=value -MaxEvents=value -FilterHashtable=value -FilterXPath=value -Path=path -ListLog=value -ListProvider=value -Oldest",
  ),
  "Get-CimInstance": spec(
    "-ClassName=value -Namespace=value -ComputerName=value -Query=value -Filter=value -Property=value",
  ),
  "Get-Module": spec("-Name=value -ListAvailable -All"),
  "Import-Module": files(
    "-Name=path -Force -PassThru -Global -Scope=Local|Global -RequiredVersion=value -MinimumVersion=value",
  ),
  "Install-Module": spec(
    "-Name=value -Repository=value -Scope=CurrentUser|AllUsers -RequiredVersion=value -MinimumVersion=value -Force -AllowClobber -WhatIf -Confirm",
  ),
  "Get-PSDrive": spec("-Name=value -PSProvider=value -Scope=value"),
  "Get-Alias": spec(
    "-Name=value -Definition=value -Exclude=value -Scope=value",
  ),
  "Set-Alias": spec(
    "-Name=value -Value=value -Description=value -Scope=value -Force -PassThru",
  ),
  "Select-Object": spec(psSelect),
  "Where-Object": spec(
    "-Property=value -Value=value -EQ -NE -GT -GE -LT -LE -Like -NotLike -Match -NotMatch -Contains -NotContains -In -NotIn",
  ),
  "ForEach-Object": spec(
    "-Process=value -Begin=value -End=value -MemberName=value -ArgumentList=value -Parallel=value -ThrottleLimit=value -AsJob",
  ),
  "Sort-Object": spec(
    "-Property=value -Descending -Unique -CaseSensitive -Stable",
  ),
  "Group-Object": spec(
    "-Property=value -NoElement -AsHashTable -AsString -CaseSensitive",
  ),
  "Measure-Object": spec(
    "-Property=value -Average -Sum -Maximum -Minimum -Line -Word -Character",
  ),
  "Select-String": files(
    "-Pattern=value -Path=path -LiteralPath=path -SimpleMatch -CaseSensitive -AllMatches -Context=value -Quiet -List -NotMatch -Encoding=value",
  ),
  "Format-Table": spec(
    "-Property=value -AutoSize -Wrap -HideTableHeaders -GroupBy=value",
  ),
  "Format-List": spec("-Property=value -GroupBy=value -Force"),
  "Out-File": files(
    "-FilePath=path -LiteralPath=path -Append -Force -NoClobber -NoNewline -Width=value -Encoding=value",
  ),
  "ConvertTo-Json": spec(
    "-InputObject=value -Depth=value -Compress -AsArray -EscapeHandling=Default|EscapeNonAscii|EscapeHtml",
  ),
  "ConvertFrom-Json": spec(
    "-InputObject=value -AsHashtable -Depth=value -NoEnumerate",
  ),
  "Import-Csv": files(
    "-Path=path -LiteralPath=path -Delimiter=value -Header=value -Encoding=value -UseCulture",
  ),
  "Export-Csv": files(
    "-Path=path -LiteralPath=path -Delimiter=value -Encoding=value -UseCulture -NoTypeInformation -Append -Force",
  ),
  "Invoke-WebRequest": spec(
    "-Uri=value -Method=Get|Post|Put|Patch|Delete|Head|Options -Headers=value -Body=value -OutFile=path -InFile=path -UseBasicParsing -TimeoutSec=value -ContentType=value",
  ),
  "Invoke-RestMethod": spec(
    "-Uri=value -Method=Get|Post|Put|Patch|Delete|Head|Options -Headers=value -Body=value -OutFile=path -InFile=path -TimeoutSec=value -ContentType=value",
  ),
  "Test-NetConnection": spec(
    "-ComputerName=value -Port=value -CommonTCPPort=HTTP|RDP|SMB|WINRM -TraceRoute -InformationLevel=Quiet|Detailed",
  ),
  "Get-NetTCPConnection": spec(
    "-LocalAddress=value -LocalPort=value -RemoteAddress=value -RemotePort=value -State=Listen|Established|TimeWait|CloseWait -OwningProcess=value",
  ),
  "Get-NetIPAddress": spec("-InterfaceAlias=value -AddressFamily=IPv4|IPv6"),
  "Resolve-DnsName": spec(
    "-Name=value -Type=A|AAAA|CNAME|MX|NS|TXT|PTR|SOA -Server=value -DnsOnly",
  ),
  "Compress-Archive": files(
    "-Path=path -LiteralPath=path -DestinationPath=path -CompressionLevel=Optimal|NoCompression|Fastest -Force -Update",
  ),
  "Expand-Archive": files(
    "-Path=path -LiteralPath=path -DestinationPath=dir -Force -PassThru",
  ),
  "Get-Date": spec(
    "-Date=value -Format=value -UFormat=value -DisplayHint=Date|Time|DateTime",
  ),
  "Set-ExecutionPolicy": spec(
    "-ExecutionPolicy=Restricted|AllSigned|RemoteSigned|Unrestricted|Bypass|Undefined -Scope=Process|CurrentUser|LocalMachine -WhatIf -Confirm",
  ),
  "Get-ExecutionPolicy": spec("-List -Scope=Process|CurrentUser|LocalMachine"),
  "Write-Output": spec("-InputObject=value -NoEnumerate"),
  "Write-Host": spec(
    "-Object=value -NoNewline -Separator=value -ForegroundColor=value -BackgroundColor=value",
  ),
  "Read-Host": spec("-Prompt=value -AsSecureString -MaskInput"),
  "Start-Sleep": spec("-Seconds=value -Milliseconds=value -Duration=value"),
  "Clear-Host": spec(),
  "Get-Variable": spec("-Name=value -Scope=value -ValueOnly"),
  "Set-Variable": spec(
    "-Name=value -Value=value -Scope=value -Force -PassThru",
  ),
};

const aliases: Record<string, keyof typeof powershell> = {
  ls: "Get-ChildItem",
  dir: "Get-ChildItem",
  gci: "Get-ChildItem",
  cd: "Set-Location",
  sl: "Set-Location",
  chdir: "Set-Location",
  pwd: "Get-Location",
  gl: "Get-Location",
  pushd: "Push-Location",
  popd: "Pop-Location",
  cat: "Get-Content",
  gc: "Get-Content",
  type: "Get-Content",
  sc: "Set-Content",
  cp: "Copy-Item",
  copy: "Copy-Item",
  cpi: "Copy-Item",
  mv: "Move-Item",
  move: "Move-Item",
  rm: "Remove-Item",
  del: "Remove-Item",
  ri: "Remove-Item",
  ren: "Rename-Item",
  ni: "New-Item",
  gcm: "Get-Command",
  help: "Get-Help",
  man: "Get-Help",
  h: "Get-History",
  history: "Get-History",
  ps: "Get-Process",
  gps: "Get-Process",
  kill: "Stop-Process",
  saps: "Start-Process",
  gsv: "Get-Service",
  select: "Select-Object",
  where: "Where-Object",
  foreach: "ForEach-Object",
  sort: "Sort-Object",
  group: "Group-Object",
  measure: "Measure-Object",
  sls: "Select-String",
  ft: "Format-Table",
  fl: "Format-List",
  iwr: "Invoke-WebRequest",
  irm: "Invoke-RestMethod",
  echo: "Write-Output",
  cls: "Clear-Host",
  clear: "Clear-Host",
  sleep: "Start-Sleep",
};

const windows = {
  winget: spec(
    "--source=value -s=value --accept-source-agreements --disable-interactivity",
    "search install show list upgrade uninstall export import source settings features configure repair download pin",
    {
      install: spec(
        "-e --exact --id=value --name=value --version=value --scope=user|machine --silent --interactive --accept-package-agreements",
      ),
      upgrade: spec(
        "--all --id=value --include-unknown --silent --accept-package-agreements",
      ),
      source: spec("", "list add remove reset update export"),
    },
  ),
  choco: spec(
    "-y --yes --no-progress --source=value",
    "install upgrade uninstall list search info outdated source config feature",
  ),
  scoop: spec(
    "",
    "install uninstall update list search info status bucket config cleanup cache hold reset",
    { bucket: spec("", "add list known rm"), cache: spec("", "show rm") },
  ),
  wsl: spec(
    "--list -l --verbose -v --status --version --install --uninstall --online --update --shutdown --distribution=value -d=value --user=value -u=value --cd=dir --exec=value -e=value --terminate=value --export=value --import=value",
  ),
  "curl.exe": curl,
  "where.exe": spec("/R=dir /Q /F /T"),
  "sc.exe": spec(
    "",
    "query queryex start stop qc config create delete description",
  ),
  ipconfig: spec("/all /release /renew /flushdns /displaydns /registerdns"),
  netstat: spec("-a -n -o -b -r -s -p=TCP|UDP|TCPv6|UDPv6"),
  tasklist: spec("/FI=value /FO=TABLE|LIST|CSV /NH /V /SVC /M"),
  robocopy: dirs(
    "/E /S /MIR /COPY=value /DCOPY=value /R=value /W=value /MT=value /XD=dir /XF=path /L /NP /LOG=path",
  ),
  explorer: dirs(),
  notepad: files(),
  pwsh: files(
    "-NoLogo -NoProfile -NoExit -File=path -Command=value -WorkingDirectory=dir -ExecutionPolicy=RemoteSigned|Bypass|Restricted -NonInteractive",
  ),
  powershell: files(
    "-NoLogo -NoProfile -NoExit -File=path -Command=value -ExecutionPolicy=RemoteSigned|Bypass|Restricted -NonInteractive",
  ),
  cmd: spec("/C=value /K=value /D /Q /V:ON /V:OFF"),
};

const windowsTools = new Set(
  words(
    "make ansible ansible-playbook tmux rsync wget curl zip unzip nano less",
  ),
);

const index = (entries: Record<string, CommandSpec>, ignoreCase = false) =>
  new Map(
    Object.entries(entries).map(([name, value]) => [
      ignoreCase ? name.toLowerCase() : name,
      value,
    ]),
  );

const cmdlets = index(powershell, true);
for (const [alias, name] of Object.entries(aliases))
  cmdlets.set(alias, powershell[name]);

export const catalogs = {
  posix: index(posix),
  bash: index(bash),
  zsh: index(zsh),
  linux: index(linux),
  macos: index(macos),
  bsd: index(bsd),
  windows: index(windows),
  powershell: cmdlets,
};

export const commandNames = {
  posix: [...Object.keys(posix), ...tools.keys()],
  powershell: [
    ...Object.keys(powershell),
    ...Object.keys(aliases),
    ...Object.keys(windows),
    ...[...tools.keys()].filter((name) => !windowsTools.has(name)),
  ],
};

export const commonPowerShellOptions = spec(psParameters).options;
