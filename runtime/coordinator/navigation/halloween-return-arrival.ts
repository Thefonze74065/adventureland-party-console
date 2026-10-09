/** Halloween checkpoint retirement must agree with the shared route's physical
 * point arrival. Unrelated legacy returns keep their established proximity;
 * shaped farming areas continue to use their own boundaries. */
export function returnArrivalRadius(owner: {event?: string | null}): number {
  return ["slenderman", "mrgreen", "mrpumpkin"].includes(owner.event || "") ? 100 : 180;
}
