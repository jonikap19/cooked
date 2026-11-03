# Design: groups, share links, own recipes

Owner request (2026-11-03), verbatim: *"i want to be able to create groups, invite others to that group and then be able to share a recipe from my recipes into that group (take all my current comments with it) once the recipe is in the group it should be "disconnected" from my personal one and be its own recipe (new comments by me or my friends should only affect the group recipe). also add a way to share a recipe (choose between blank or with comments) and then be able to import them using a link? also create a way to add a custom recipe ("create own recipe" then show a blank screen like in the recipe editor and have a save recipe button at the bottom)"*

Companion to `2026-11-03-pantry-shopping-design.md` (ingredient notes, Einkaufsliste, Vorrat). That design comes first, because the group copy carries its ingredient notes.

Labels: **(owner)** marks a choice the owner made in the 2026-11-03 Q&A. **(Claude's call)** marks a default that passed playback ("seems good"), which the owner can still override.

## Intent

Today every recipe is private. This design lets a few friends cook from a shared pool, hand one recipe to someone quickly, and write down recipes that were never online.

Success looks like three things:
- The owner puts their adjusted Gnocchi into "WG". A flatmate adjusts it further, and the owner's own Gnocchi doesn't change.
- The owner sends a link "mit Kommentaren". A friend opens it the same evening and has their own copy, with the orange changes.
- The owner types grandma's recipe into an empty form and saves it.

## Goals

1. **Eigenes Rezept.** "Rezept hinzufügen" gets a third option, "Eigenes Rezept". It opens an empty form with title, servings, total time, ingredients (amount, unit, name) and steps (text, optional minutes), plus "Rezept speichern" at the bottom.
   - What the user types becomes the recipe's original. Same validation as `NewRecipe`.
   - No photo (image upload is still out of scope), so the placeholder shows. `source_platform` and `source_url` are optional.
2. **Groups.**
   - A user creates a named group and invites others **by email**. Invitees must already be allowed by the Access policy; nothing is added to Access automatically **(owner)**.
   - The invitee sees the invite the next time they open the app and accepts or declines it.
   - All members are equal: invite, adjust, comment, cook, delete recipes **(owner)**.
   - Members can leave. When the last member leaves, the group and its recipes are deleted **(Claude's call)**.
3. **Share into a group.** "In Gruppe teilen" on a personal recipe creates an **independent copy** owned by the group. The copy includes **(owner)**:
   - the originals
   - all of the user's adjustments (still shown as adjustments, orange)
   - ingredient notes
   - "Notiz für mich", which becomes the group recipe's shared note **(Claude's call)**

   From then on the two are fully disconnected. Changes in the group affect only the group copy, and changes to the personal recipe never reach the group **(owner)**.
4. **Group recipes behave like personal ones** for the Einkaufsliste, Vorrat and "Fertig gekocht", using the user's own list and Vorrat **(owner)**.
   - Adjustments and ingredient notes on a group recipe show the author's initials (`initials()` already exists) **(Claude's call)**.
5. **Share link.** "Teilen" on a recipe asks for one of two versions:
   - **ohne Kommentare**: the user's current merged version with adjustments **baked in** as the new originals. No adjustments, no notes, no personal note **(owner)**.
   - **mit Kommentaren**: originals plus adjustments, ingredient notes and the personal note **(owner)**.

   The link holds a **frozen copy** taken at share time. It opens only for logged-in app users (inside Access) and expires **24 h** after creation **(owner)**. Opening it shows a read-only preview and "Ins Kochbuch übernehmen", which creates the opener's own independent personal recipe. After 24 h the link shows "Link abgelaufen".

## Non-goals

- Inviting people who aren't on the Access policy, or editing the Access policy from the app **(owner)**.
- Public, unauthenticated recipe pages **(owner: app users only)**.
- Live links, or any sync between copies (personal ↔ group, sharer ↔ importer).
- Roles or permissions inside a group **(owner: all equal)**.
- Group shopping lists or group Vorrat. Lists and Vorrat stay personal.
- Moving a group recipe back into a personal cookbook. This can be added later.

## Anti-goals

- **Leaks across the boundary.** A change in a group shows up in someone's personal recipe, or the reverse.
- **Access by guessing.** Someone sees a recipe or group they're not part of, by guessing an id or a token. Every read checks membership or ownership server-side, and foreign ids return 404.
- **A link that still works after 24 h,** or one that can be used from outside the Access login.
- **Lost originals.** Copying loses the original values, so "Original zeigen" or "Zurücksetzen" in the copy behave differently from the source.

## Constraints

- All MVP and next-features Global Constraints still apply: German UI, tokens, orange only for adjustments, ≥ 44 px, no emojis, originals insert-only, https-only URLs, input limits, additive migrations, and manual deploys with migrations first.
- `user_id` is the lower-cased Access email, and there is no users table (CLAUDE.md decision). An invite is addressed to an email: it's normalised the same way, and the invitee "has" it when their JWT email matches.
- Today recipes are scoped by `recipes.user_id`. A group recipe must be readable and writable by every current member and by nobody else, and every existing route (recipes, adjustments, notes, ingredient notes, images, split, lists) must apply the same rule. The rule lives in **one** access check that all routes use; do not add a membership check per route.
- Images: a copy (group or share import) gets its **own** R2 object, copied server-side at copy time. Deleting the source must never break the copy. A share link's frozen copy references the source image only until import. If the source image is gone by then, the import has no image.
- Share tokens are random (≥ 128 bits), stored with `expires_at`, and checked server-side on every read and import. Expired rows can be deleted lazily.
- Invites and share-link creation are rate-limited (abuse-prone per rules.md). Reuse the existing rate-limit binding pattern.
- Security review before merging the groups and share-link PRs (rules.md §2: touches data access).

## Decided behaviour details

- **Copy semantics.** A copy duplicates the recipe's rows with new ids, and every reference is remapped to its new id:
  - `ingredients` and `steps`, keeping the original values, so the copy's "Original" equals the source's original
  - `adjustments`, with `target_id` and `insert_after` remapped
  - ingredient notes, with their keys remapped
  - the note
  - the image object

  For "ohne Kommentare", the merged view (`mergeRecipe`) is written as the new originals, skipping removed items, and nothing else is copied.
- **Author on group edits.** Adjustments and ingredient notes made in a group store the author's `user_id`. Ones copied from a personal recipe get the sharer as author **(Claude's call)**.
- **Pantry matching on copies (Claude's call).** Each user's matching stays personal. A group recipe is matched for each user the first time that user puts it on their list or cooks it, using the lazy path from the pantry design.
- **Invites.** These outcomes are distinct:
  - inviting yourself → 400
  - inviting someone who is already a member, or already invited → idempotent
  - declining → the invite is deleted
  - an invite is tied to one email, and only that email can see or accept it
- **Group membership changes.**
  - Leaving removes the user's membership. Their past adjustments and notes stay in the group recipes.
  - Deleting a group recipe deletes it for everyone (all members are equal).
- **Several authors, one layer (Claude's call).** A group recipe keeps the existing model: one adjustment per target, one ingredient note per ingredient. When a member edits something another member already changed, the last write wins and the author becomes the last editor. Any member may reset or remove anyone's adjustment or note, since all members are equal.
- **Ownership (Claude's call).** `recipes.user_id` stays as the creator, and group recipes add a `group_id`. Access to a group recipe is decided by group membership alone, so a group recipe stays readable when its creator leaves. The image route uses the same access check, not the R2 owner tag, for recipe images.
- **A group recipe that disappears for you (Claude's call).** This covers three cases: another member deletes it, you leave, or the group is deleted. In each case your planned shopping-list entries for that recipe are removed, so their lines vanish, and so are your pantry mappings for it. Your Vorrat is untouched. The pantry design's list and mapping tables therefore reference the recipe with cascading deletes. Leaving a group deletes your entries for that group's recipes explicitly.
- **Share links are multi-use until expiry (owner).** Anyone logged in who has the link can import their own copy any number of times within the 24 h. There is no revoke **(Claude's call)**. Each import copies the image again, independently.
- **What a copy carries (Claude's call).** Title, servings, `total_minutes`, `tags`, `source_url` and `source_platform` come along in every copy (group, link, either variant).
- **Limits (Claude's call).** At most 20 groups per user, 20 members per group and 20 pending invites per group. Invites and share-link creation each have their own rate limit of 20 per minute per user.
- **Navigation (Claude's call).** The bottom bar from the pantry design gets a fourth tab, **Gruppen**. It shows the list of groups, then the group's recipes, with the same cards as Home. Pending invites show as a banner on Home and in Gruppen.

## New German strings

"Eigenes Rezept", "Rezept speichern", "Gruppen", "Gruppe erstellen", "Einladen", "Einladung annehmen", "Ablehnen", "Gruppe verlassen", "In Gruppe teilen", "Teilen", "ohne Kommentare", "mit Kommentaren", "Link kopieren", "Gültig für 24 Stunden", "Ins Kochbuch übernehmen", "Link abgelaufen", "Geteilt von {Initialen}".

## Left to the builder

- Table layout. Likely shape: `groups`, `group_members`, `group_invites`, a nullable `recipes.group_id` (a group recipe has no owning user, or keeps the sharer as creator), `share_links`, and an author column on adjustments and ingredient notes.
- How the single access check is expressed (a SQL helper or a middleware).
- The frozen-copy format of a share link, either a JSON snapshot or copied rows. It must reproduce exactly what the sharer saw.
- Whether the "Eigenes Rezept" form reuses the AddRecipe preview editor or the EditSheet components.
- The phase and PR split. Suggested order, each as one PR against `main` after the previous one merges:
  1. Eigenes Rezept
  2. the pantry design (notes, matching, Vorrat, Einkaufsliste, cooked)
  3. share links
  4. groups

## Out of scope (ask before adding)

Public pages, live sync, group roles, group shopping lists or Vorrat, moving a group recipe back to personal, photo upload, comment threads or chat, notifications or emails for invites.
