# Open-source stack

![GitHub Repo stars](https://img.shields.io/github/stars/forge-42/open-source-stack?style=social)
![npm](https://img.shields.io/npm/v/open-source-stack?style=plastic)
![GitHub](https://img.shields.io/github/license/forge-42/open-source-stack?style=plastic)
![npm](https://img.shields.io/npm/dy/open-source-stack?style=plastic)
![npm](https://img.shields.io/npm/dw/open-source-stack?style=plastic)
![GitHub top language](https://img.shields.io/github/languages/top/forge-42/open-source-stack?style=plastic)

Full starter stack to develop CJS/ESM compatible npm packages with TypeScript, Vitest, Biome, Prettier, and GitHub Actions.

Detailed overview of the stack:
https://youtu.be/ABRpwxLdGho

Deploy your open-source project to npm with ease, with fully covered bundling, testing, linting and deployment setup out of the box,
don't worry about CJS or ESM, bundling your typescript definitions or anything else, focus on coding out your solution and let the stack take care of the rest.

Build your own open-source project today! 🚀

## Tools

- **TypeScript**: TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.
- **Vitest**: A modern test runner built on top of Vite.
- **Biome**: Biome statically analyzes your code to find issues and formats your code with a consistent, opinionated style.
- **GitHub Actions**: Automate your workflow from idea to production.
- **tsdown** - Simple to config bundler powered by rolldown.
- **Changeset** - A way to manage your versioning and changelog with a focus on monorepos.
- **pnpm workspaces** - A way to manage multiple packages in a single repository.

## Features

- **NX workflows and caching** - Use the power of NX to manage your monorepo and speed up your builds with caching.
- **ESM/CJS ready** - Write your code in TypeScript and publish it as ESM and CJS with 0 configuration.
- **Are The types wrong? ready** - Passes all the checks for typings on https://arethetypeswrong.github.io/ by default.
- **ESM/CJS test apps setup** - Test your package in both ESM and CJS environments already setup for you.
- **Test runner setup** - Test your open source package with Vitest already setup for you.
- **Linting setup** - Lint your code with Biome already setup for you.
- **GitHub Actions setup** - Automate deployments to npm by using GitHub Actions.
- **Changeset versioning & automation** - Automate releases with Changeset and GitHub Actions.

## Setup

1. Use this template to create a new repository.
2. Clone the repository.
3. Change the package name in `package.json`.
4. Change the `open-source-stack` dependency in your test-apps to your name
5. Change the `open-source-stack` folder name in packages to your package name
6. Install the dependencies with `npm install`.
7. Change the `repository`, `bugs`, and `homepage` fields in `package.json` to your github repo.
8. Change the license if required.
9. Add the NPM_TOKEN secret to your GitHub repository.
10. Allow GitHub Actions to create and approve pull requests. (Settings -> Actions -> Workflow permissions)
11. Start coding!

## Development

To start developing your package, run the following command:

```bash
pnpm run dev
```

This will start the watch mode for your package and build it on every change.

Then you can test your package in the test-apps folder.

Pick one of the test apps and run the following commands:

```bash
cd test-apps/react-router-esm

pnpm run dev
```

If you want to add more packages, don't forget to add them to the `overrides` section in the root `package.json`.

Also, if you want to add more test-apps using the latest version of the package instead of `workspace:*` in the dependencies is recommended.

## Scripts

- `pnpm run build` - Build the package(s).
- `pnpm run test` - Run the tests.
- `pnpm run check` - Lint the code.
- `pnpm run dev` - Start the package(s) watch mode.
