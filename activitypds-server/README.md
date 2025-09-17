# ActivityPDS

An example server showing that it's possible to reuse the OAuth from AT Proto in other applications.

Some of the code in this directory is taken directly from the [atproto codebase](https://github.com/bluesky-social/atproto), when implementing myself didn't really make much sense yet. Examples are:
- `src/utils/`
- `src/db/cast.ts` (although I've modified it to handle `Date` objects by automatically converting to/from ISO Date strings)
- `src/config.ts` (this is largely based on the atproto code)