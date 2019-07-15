# About

Features:
- doctor; inspect installation
- clean; clean up Atom's config.cson, removing duplicates, uninstalled package settings, etc.
- install; install package from atom.io. Look for `apx-bundle-<version>.tar.gz` over source code.
- uninstall; uninstall package (fail on symlink)
- link; symlink to packages
- unlink; remove symlink
- info <package>; log package details

# Installation
1. Have npm and NodeJS installed. Using a version manager, such as `nvm`, is highly recommended.
2. Run
```
npm install -g @aerijo/apx
```

# Commands

## Install

### `install <package>[@<version>]`

1. Poll atom.io API for <package>, with specified or latest version
2. Extract the GitHub owner & repo
3. Get the corresponding GitHub tag / release
4. If present, get download URL for `apx-bundled-<version>.tgz`
5. Else, use provided tarball URL from atom.io API request
6. Run `npm install` with selected URL

## Publish

### `publish [increment | version]`

0. Require that the folder is a git repo and a package
1. Require all changes have been pushed
2. Run the following in parallel
  1. Validate the package (not required, but useful)
    1. Inspect the `package.json` for issues
    2. Run `npm audit --only=prod`
  2. Attempt to register package
    1. 201 - successful, and first time
    2. 400 - repository is invalid
    3. 409 - package by that name already exists
      1. Check if the existing package is this one or not
  3. Run `npm version [increment | version]`
    0. TODO: Set tag prefix to `v`with `--tag-version-prefix="v"`
    1. And push generated commit & tag
3. Wait for tag to be visible on GitHub
4. Publish new version
  1. 200 - successful
  2. 400 - tag not found / invalid repo
  3. 409 - version already exists
5. Prepare and load assets to GitHub
