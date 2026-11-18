# Bolted Joint Calculator

**Live:** https://ehcrea.github.io/bolted-joint-calculator/

**Status:** draft v0.1. The calculation core and visuals work; translations, inch units and more joint types are still to come (see the roadmap).

A browser-based tool for engineers, makers, designers and students to **size and check bolted joints**. Pick the joint type, the bolt, the stack of clamped parts, the friction and the tightening method, and the loads. It returns the **tightening torque** and runs the checks of the **VDI 2230 Part 1** method, showing every formula with your numbers.

## What it calculates

- **Preload and tightening torque**: permissible assembly preload at a chosen yield utilisation ν (VDI 2230 R5), or the preload from a given torque. The scatter from the friction range and the tightening factor α<sub>A</sub> gives F<sub>M,min</sub> and F<sub>M,max</sub>. The torque is split into pitch, thread friction and head friction
- **Resilience of the bolt** (head, shank, free thread, engaged thread, nut or tapped thread zones) and of the **clamped parts** with the deformation cone and sleeve model, including stacks of different materials and washers
- **Load factor** Φ<sub>K</sub>, Φ<sub>n</sub> with the load introduction factor n, and the **joint diagram**
- **Preload losses** from **embedding** (VDI 2230 table 5 by roughness, axial or transverse load) and from **temperature** (different expansion of bolt and parts)
- **Required clamp load** for friction grip against transverse loads (slip safety S<sub>G</sub>) and for sealing or other needs; **residual clamp load** and joint opening
- **Working stress** (tension + residual torsion) and the yield safety S<sub>F</sub>
- **Fatigue**: alternating stress against the thread endurance limit, rolled before or after heat treatment
- **Surface pressure** under the head, nut and washers against the limiting pressure p<sub>G</sub> of each material
- **Thread stripping and engagement length** for a nut, a tapped hole, a **Heli-Coil** (wire thread insert, STI hole) or a **solid threaded insert**: strength of each thread against the bolt breaking load and the engagement length needed for the bolt to break first
- **Bolt length** from clamp length and engagement, rounded to a standard length
- **Bolt patterns**: circular or rectangular patterns with forces and moments on the flange; rigid-flange load distribution (centroid model for closed joints, heel model for opened joints), plan view with the tension and shear on each bolt, and the most loaded bolt checked with all the methods above
- **Eccentric clamping and loading** (VDI 2230 Part 1, joint closed): load factor Φ<sub>en</sub>* from the bending resilience of the parts, clamp load F<sub>KA</sub> against one-sided opening, and the bolt bending factor on the alternating stress; bending inertia estimated or entered
- **Prying** of T-stub and angle flanges: Douty & McGuire prying ratio, prying force added to the bolt load, flange bending checks at the web face and the bolt line
- **Aerospace check (NASA-STD-5020)**, optional: preload range from the torque range and the preload uncertainty Γ, relaxation, running torque of locking features, factors of safety and fitting factor, and margins of safety for separation, slip, yield, ultimate tension, thread shear-out, bolt shear and tension–shear interaction
- **Locking elements** under the head: split lock washer (DIN 127, flagged as ineffective), conical spring washer (DIN 6796, modelled as a spring that recovers settling once below its flat load), wedge-locking washer pair (DIN 25201), and thread-locking adhesive with its own friction ranges
- **Clamp length ratio** l<sub>K</sub>/d with the share of preload lost to settling: a note below 3 (the common design rule, e.g. in semiconductor equipment) and a warning below 1

## Visuals

- Cross-section of the joint with the **deformation cone** (angle φ, D<sub>A,Gr</sub>), each clamped part and washer, the engaged thread, the coil or insert, and the **bolt zones** used for the resilience
- **Joint diagram** (force against elongation) with F<sub>M,max</sub>, F<sub>V,min</sub>, F<sub>SA</sub>, F<sub>PA</sub> and F<sub>KR</sub>
- **ISO thread profile** with d, d<sub>2</sub>, d<sub>S</sub>, d<sub>3</sub> and the stress area A<sub>S</sub> compared with A<sub>d3</sub> and the nominal area
- **Preload against friction** at the tightening torque, with the yield limit and the required preload
- **Calculation steps** R0 to R13 with formulas and substituted values

## Examples

22 application examples, sorted from the smallest bolt to the largest, from M2.5 up to M16 slip-critical splices. Small fasteners: M4 bolt and nut through thin sheets, M4 stainless into aluminium, M3 with a Heli-Coil in magnesium, four **electronics enclosure** joints (stainless M2.5 to M4 screws in 5083 / 6061 aluminium with Heli-Coils, including a −55 K cold soak and a spacer sleeve that brings l<sub>K</sub>/d above 3), and two **PCB mounts** (M3 to a brass standoff, M3 into an aluminium housing with +50 K). The PCB cases show why circuit boards need care: FR-4 is soft through its thickness, so the board dominates the joint stiffness, and embedding and creep take a large share of the small preload.

## Libraries

| Library | Contents |
|---|---|
| Threads | ISO 261 metric coarse M2 to M36 and fine threads, with ISO 4017 / 4032 hex and ISO 4762 socket head dimensions, ISO 273 clearance holes and ISO 7089 / 7093 washers |
| Property classes | 4.6, 5.6, 5.8, 8.8, 10.9, 12.9 (ISO 898-1), A2/A4-50, -70, -80 (ISO 3506-1), titanium grade 5 |
| Materials | Structural and quenched-and-tempered steels, stainless steels, grey and ductile cast iron, aluminium alloys (wrought and die-cast), magnesium, titanium, brass, POM, PA6-GF30 and FR-4 circuit boards (through-thickness values): E, α, R<sub>m</sub>, R<sub>p</sub>, p<sub>G</sub>, shear strength |
| Friction | Oiled black oxide, zinc plated, zinc flake, MoS₂, stainless dry and with paste, aluminium parts, titanium, thread-locker on steel and stainless (VDI 2230 table A5, ISO 16047 coating ranges) |
| Locking elements | Split lock washers, conical spring washers (size, free height, flat load), wedge-locking washer pairs: typical catalogue values |
| Tightening | Yield- and angle-controlled, ultrasonic, hydraulic tensioner, torque wrench, power tool, impact wrench (VDI 2230 table A8) |

Values marked ~ are typical estimates and not from VDI 2230: check them against your supplier's data.

## Scope and limits of this draft

- Single bolt with a concentric or eccentric axial load. Bolt patterns use a rigid-flange load distribution; prying uses an elastic T-stub formula; the eccentric case is valid only while the joint stays closed (opened joints and flexible-flange load sharing are not covered), and its bending inertia Ī<sub>Bers</sub> is a simplified estimate
- Clamped parts of different materials are combined with one series modulus in the cone model (VDI 2230 treats each layer separately)
- The compliance of a soft material around a threaded insert is not included in the bolt resilience
- Thread stripping uses the ISO basic profile shear areas with simplified reduction factors

> The results are design guidance. Safety-critical joints need a full VDI 2230 analysis and testing.

## Run it

It's a static site with no build step and no dependencies. Serve the folder and open it in a browser:

```bash
python3 -m http.server 8771
```

Then go to http://localhost:8771. It can be hosted on GitHub Pages as is.

## Tests

```bash
node tests/calc.test.js
```

The tests check the stress areas against ISO 898-1, the permissible preload against VDI 2230 table A1, the cone / sleeve regimes, load factor, embedding, temperature effects, washers, the torque-mode inverse, stripping trends for tapped holes and Heli-Coils, every application example and every thread with every joint type.

## Project layout

| File | Purpose |
|---|---|
| `js/data.js` | Threads, head / nut / washer / hole dimensions, property classes, materials, friction, tightening factors, embedding |
| `js/calc.js` | VDI 2230 calculation (R0 to R13) and thread stripping |
| `js/drawing.js` | SVG cross-section, joint diagram, thread profile, friction chart, torque split |
| `js/presets.js` | Default design and application examples |
| `js/app.js` | User interface and calculation steps |
| `css/style.css` | Styles (shared design system of the ehcrea engineering tools) |

## Roadmap

- Translations (DE, NL, TR, ES) and inch units / UNC-UNF threads, like the other ehcrea tools
- Opened eccentric joints, plastic T-stub models (EN 1993-1-8, AISC), flexible flanges, custom bolt positions
- Per-layer cone model, countersunk and flange heads, reduced-shank (waisted) bolts
- Heat-set and press-in inserts for plastics and 3D prints, self-tapping screws in plastics
- PDF report, unit converter, SEO language pages and social image

## References

- VDI 2230 Blatt 1:2015, *Systematic calculation of highly stressed bolted joints: joints with one cylindrical bolt*
- ISO 898-1, ISO 3506-1, ISO 261, ISO 724, ISO 273, ISO 4017, ISO 4032, ISO 4762, ISO 7089, ISO 7093-1, ISO 16047
- DIN 8140 (wire thread inserts), FED-STD-H28/2B (thread shear areas)
- G. L. Kulak, J. W. Fisher, J. H. A. Struik, *Guide to Design Criteria for Bolted and Riveted Joints* (prying, Douty & McGuire)
- NASA-STD-5020B, *Requirements for Threaded Fastening Systems in Spaceflight Hardware*; ECSS-E-HB-32-23A, *Threaded fasteners handbook*; NASA RP-1228, *Fastener Design Manual*
- DIN 127 (withdrawn), DIN 6796, DIN 25201, DIN 65151 / ISO 16130 (Junker test), ISO 10964 and ASTM D5363 / MIL-S-22473 (anaerobic thread-lockers)
- J. H. Bickford, *Introduction to the Design and Behavior of Bolted Joints*

This project is not affiliated with or endorsed by VDI, NASA or any fastener manufacturer. Heli-Coil is a trademark of its owner and is used here only to name the insert type.

## License

[MIT](LICENSE) © 2026 E. Tozlu · [ehcrea.com](https://ehcrea.com) · more tools at [tools.ehcrea.com](https://tools.ehcrea.com)
