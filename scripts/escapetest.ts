/**
 * The four Center Perks escapes (GDD §12), each won by a bot from day 1 through the real
 * simulation, every guard on duty, with ordinary commands. Each bot keeps the routine like a
 * model prisoner with its escape kit hidden in the desk's compartment (the recipe graph and
 * the economy tests prove the kit can be had), then goes:
 * - perimeter cutout: Lights Out, the dummy in bed, a guard's uniform, plastic keys to the
 *   generator room; the power off, the electric fence cut before it comes back;
 * - tunnel: Lights Out, the dummy in bed, under the desk and north beneath the wall and the
 *   fence, braced every third tile, dug up onto the road;
 * - rooftop: Lights Out, the dummy in bed, the cell's grate unscrewed (a fake cover behind),
 *   the vents to the ladder, the roof's edge, a grapnel over the fence and a sheet rope down;
 * - takeover: Strength and Speed trained to 90, plated armor and nunchucks, two followers;
 *   one blow at a guard and every guard comes; all five out cold opens the gates.
 * Stalag Flucht and Shankton follow the same four routes on their own maps (`PLANS`); San
 * Pancho has its own three: the deep tunnel, the supply road's gate on cloned keys, the takeover.
 * The snapshot pins each run: when it got out, how, the heat's peak, and the tally.
 */
import { runAll } from './escapes';

runAll();
