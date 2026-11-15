# Set up LoopStack with an AI assistant

If you'd rather not run the commands yourself, a coding assistant that can use your Mac's terminal (such as Claude Code) can build LoopStack and walk you through connecting it.

## For you: paste this prompt

Open your assistant in an empty folder and paste:

```text
Please set up LoopStack on my Mac for me. LoopStack is an open-source Mac app for people who use Loop, at https://github.com/Rdeboer180/LoopStack.

Read SETUP-WITH-AI.md in that repository and follow the "For the assistant" section exactly. Explain each step in plain language before you do it, and ask me before installing anything. Never ask me to paste a token, API secret, password or API key into this chat: I'll type those into the LoopStack app myself.
```

The assistant will tell you what it's doing at each step. You'll type your tokens into LoopStack yourself, never into the chat.

## For the assistant

You are helping a person with type 1 diabetes install LoopStack, a local, read-only Mac app. Work in plain language; the person may not be technical.

### Rules

1. **Never handle secrets.** Never ask for, read, type, store or print a Nightscout token or `API_SECRET`, a GitHub token, an Anthropic API key, or a password. The person enters these in LoopStack's Settings, which keeps them in the macOS keychain. If they paste one into the chat, tell them to revoke it and make a new one.
2. **Ask before installing anything** (Homebrew, Node.js, Git). Say what it is and why it's needed.
3. **Give no medical advice.** Don't interpret their glucose data or suggest doses or settings. LoopStack shows observations; decisions belong to the person and their care team.
4. **Don't change their Loop.** Don't touch their LoopWorkspace fork or start a build. That's done inside LoopStack, with the person's review and confirmation.

### Steps

1. **Check the Mac.** Run `uname -m`; it must print `arm64` (Apple silicon). If it prints `x86_64`, stop: LoopStack currently builds for Apple silicon only.
2. **Check the tools.** Run `node -v` (needs 20 or later) and `git --version`. If either is missing or too old, ask before installing. With Homebrew: `brew install node git`. Without it, point the person to https://nodejs.org (LTS installer).
3. **Get the code.**
   ```bash
   git clone https://github.com/Rdeboer180/LoopStack.git
   cd LoopStack
   ```
4. **Install and build.** This takes a few minutes.
   ```bash
   npm install
   npm --prefix desktop install
   npm run desktop:test
   npm run desktop:dist
   ```
   If the tests fail, stop and show the person the failing output; suggest opening an issue on the repository. Don't edit the code to make them pass.
5. **Install the app.**
   ```bash
   cp -R desktop/release/mac-arm64/LoopStack.app /Applications/
   open /Applications/LoopStack.app
   ```
   If macOS blocks it, have the person open **System Settings → Privacy & Security** and choose **Open Anyway** next to the LoopStack message. Don't run commands that turn off Gatekeeper.
6. **Show them around.** LoopStack opens on a synthetic sample patient. Suggest they look at My dashboard, Favorite foods and the Care-team review first.
7. **Connect Nightscout (in the app).** Walk them through it, without seeing the token:
   - In Nightscout: **Admin tools → Subjects**, add a subject with the `readable` role, and copy its token.
   - In LoopStack: **Settings → Your data**. Enter the Nightscout address and paste the token there, then choose **Connect**.
8. **Optional connections (in the app).**
   - *Ask & build:* an Anthropic API key from https://console.anthropic.com, pasted into **Settings → AI connector**. Usage is billed to their Anthropic account.
   - *Your Loop:* a GitHub fine-grained token for only their LoopWorkspace repository, with Contents and Actions set to read and write, entered in **Settings → Your Loop**.
9. **Finish.** Point them to `HOW-TO-USE.md` in the repository. To update later: `git pull`, then repeat steps 4 and 5.

### If something goes wrong

- `npm install` errors: check `node -v` again; delete `node_modules` and `desktop/node_modules` and retry once.
- The app opens but shows no data after connecting: have the person open their Nightscout address in a browser to check it loads, and check the token has the `readable` role.
- Anything else: summarize the error and suggest opening an issue at https://github.com/Rdeboer180/LoopStack/issues, without their Nightscout address, tokens or health data.
