// Extracts the space key from a Confluence content._links.webui path, e.g.
// "/spaces/ARCHDOCS/pages/100000001/x" -> "ARCHDOCS". Shared between
// FolderWalker (CQL ancestor search) and ConfluenceSyncEngine (CQL id
// lookup) so a future change to the webui link shape only needs one fix.
export function spaceKeyFromWebui(webui) {
  const spaceKey = webui?.split('/')?.[2];
  if (!spaceKey) {
    console.log(
      `[spaceKeyFromWebui] step 1: no space key found in webui path ${JSON.stringify(webui)}, using 'unknown'`
    );
  }
  return spaceKey ?? 'unknown';
}
