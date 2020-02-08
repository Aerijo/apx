# About

Alternative package manager for Atom.

## ...why?

The default package manager `apm` currently has some deficiencies
- There is little to no indication of task progress (e.g., when installing).
- Packages are installed as-is from the source code at the time of publish. This means they come with all the dev files, such as tests. Compiled projects, such as ones using TypeScript or CoffeeScript, often need to pull in extra dependencies just to compile themselves.

What `apx` does:
- Separates command steps into tasks, with updates as progress occurs. Also pipes `npm` output directly to the terminal.
- When publishing, supports generating a GitHub release, and publishing a custom release asset (generated via `npm pack`) to it. When installing, `apx` will look for and use this asset before resorting to copying the source code.
- `apx publish` without version specifier is idempotent; it will continue if a GitHub release is already detected or the version has already been registered on the Atom package registry. If a package asset already exists, it will ask if you want to replace it.

See the [docs](./doc/index.md) for demos of installing and publishing.


## Installation
1. Have npm and NodeJS installed. Using a version manager, such as `nvm`, is highly recommended.
2. Run
```
npm install -g @aerijo/apx
```
You can then use it on the command line. E.g.,
```
apx --version
```

## Commands

`apx` is still being developed. See the output of `apx --help` for a list of current commands. For any command, run `apx <command> --help` to see a more detailed description of that command. E.g., `apx install --help`.

## Planned features
- [X] doctor; inspect installation
- [ ] clean; clean up Atom's config.cson, removing duplicates, uninstalled package settings, etc.
- [X] install; install package from atom.io. Look for `apx-bundle-<version>.tar.gz` over source code.
- [X] uninstall; uninstall package (fail on symlink) - if not installed, offer "did you mean"
- [ ] update; update package to latest or specified version
- [ ] outdated; list all packages with available updates
- [X] publish; register package version to atom.io & upload assets to GitHub
- [X] link; symlink to packages
- [X] unlink; remove symlink
- [ ] info <package>; log package details
