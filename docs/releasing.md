# Releasing

1. In a PR, add a `## [x.y.z] - YYYY-MM-DD` section to the top of
   `CHANGELOG.md` and bump `version` in `package.json`.
   - Write the changelog for players: what changed in the game, not how. Leave
     out CI, refactors and docs; `git log` is the full technical record.
2. Merge the PR once CI is green.
3. Tag the merge commit and push the tag:

   ```sh
   git switch master && git pull
   git tag -a vx.y.z -m x.y.z
   git push origin vx.y.z
   ```

The tag push runs `.github/workflows/test.yml`. Once all checks pass, the
`release` job creates the GitHub Release and attaches `data-dealer-casual.xdc`
and `data-dealer-hq.xdc`. The release text is the matching `## [x.y.z]`
section of `CHANGELOG.md`. If that section is missing, the job fails. To fix
it, add the section, then delete the tag and push it again:

```sh
git push origin :refs/tags/vx.y.z
git tag -f -a vx.y.z -m x.y.z <commit>
git push origin vx.y.z
```

The webxdc store (xdcget) takes the first `.xdc` asset of the latest release,
which is the casual build because the assets sort by name.
