// One-shot hand-offs between views: Suggestions → Build opens Ask & build on
// the Next build mode. Cleared after the current task rather than on read, so
// React's double-run of state initializers in development sees it both times.
let nextBuild = false;
export const openNextBuild = () => { nextBuild = true; };
export const takeNextBuild = () => {
  const v = nextBuild;
  if (v) setTimeout(() => { nextBuild = false; }, 0);
  return v;
};

// Care-team glance → its Notes links open the detail on Notes.
let careNotes = false;
export const openCareNotes = () => { careNotes = true; };
export const takeCareNotes = () => {
  const v = careNotes;
  if (v) setTimeout(() => { careNotes = false; }, 0);
  return v;
};
