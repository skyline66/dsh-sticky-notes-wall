# Publishing dsh-sticky-notes-wall

The GitHub repository exists and is public, but it is still empty: GitHub rejects
pushes from this account until its email address is verified.

```
remote: You must verify your email address.
remote: See https://github.com/settings/emails
```

## 1. Verify the account email (one-time, in the browser)

Open <https://github.com/settings/emails>, confirm the address, then run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish.ps1
```

The script pushes `main`, creates the `v1.2.0` tag and uploads
`dsh-sticky-notes-wall.tgz` as the release asset that the marketplace entry
points at (`releases/latest/download/dsh-sticky-notes-wall.tgz`).

## 2. Plugin marketplace (awesome-dsh-plugin)

The submission is one file: [`marketplace/skyline66__dsh-sticky-notes-wall.yml`](marketplace/skyline66__dsh-sticky-notes-wall.yml).
It passes the index validator (`scripts/lib/entries.mjs`).

```bash
git clone https://github.com/skyline66/awesome-dsh-plugin.git
cd awesome-dsh-plugin
git remote add upstream https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git
git fetch upstream && git checkout -b add-sticky-notes-wall upstream/main
cp ../sticky-notes/marketplace/skyline66__dsh-sticky-notes-wall.yml data/plugins/
git add data/plugins/skyline66__dsh-sticky-notes-wall.yml
git commit -m "Add skyline66/dsh-sticky-notes-wall"
git push -u origin add-sticky-notes-wall
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin --base main \
  --title "Add skyline66/dsh-sticky-notes-wall" \
  --body "Sticky-note wall with a sidebar entry, pasted images, due reminders, done state, shortcuts, a pin-on-top floating window, appearance skins and a native always-on-top Windows desktop window."
```

Notes:

- Do not hand-edit `README.md` / `README.zh.md`; they are regenerated on `main`.
- The submission gate requires the repository to be at least one day old. Open
  the PR after that window; the gate re-runs itself and must not be resubmitted.
- Keep the `dsh-plugin` topic on the repository (already set).

## 3. npm (optional)

`dsh-sticky-notes` on npm belongs to another publisher, so this package is
published as **`dsh-sticky-notes-wall`**. npm is only needed for the format-1
catalog (`dsh-plugin-catalog`) and download figures:

```bash
npm login
npm publish --access public
```

## 4. Mirrors

`dshmarket`, the Discover index and `awesome-dsh-plugin.com` all read the same
list, so the marketplace merge is the only publication step for them.