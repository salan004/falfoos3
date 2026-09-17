/**
 * Shared Games/Tournaments atmosphere.
 *
 * Renders the supplied arena theme as a fixed page environment (never a card,
 * never a framed image) so the Stream Games hub, Game Detail and Tournament
 * Detail all sit inside one continuous visual world.
 *
 * The theme image is rendered as-is. A soft, wide, edge-free shade keeps the
 * page readable and lets the atmosphere continue seamlessly into the content
 * below — there is no section boundary, overlay box or extra image layer.
 */
export function ArenaAtmosphere() {
  return (
    <div className="arena-atmosphere" aria-hidden="true">
      <div className="arena-atmosphere-image" />
      <div className="arena-atmosphere-shade" />
    </div>
  );
}
