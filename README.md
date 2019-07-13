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

### `<package>[@<version>]`

1. Poll atom.io API for <package>, with specified or latest version
2. Extract the GitHub owner & repo
3. Get the corresponding GitHub tag / release
4. If present, get download URL for `apx-bundled-<version>.tgz`
5. Else, use provided tarball URL from atom.io API request
6. Run `npm install` with selected URL
