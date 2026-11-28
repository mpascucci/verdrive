# How the app estimates fuel, cost and CO₂

This document explains the physics and the signal processing behind the app, at the level of a first-year physics course. It does not describe the code or the interface. Where useful, it names the file that implements each part.

Units are SI throughout (m, s, kg, m/s, m/s², N, W) unless stated otherwise.

---

## 1. What does the app actually compute?

The phone has no connection to the engine. All it knows is what the GPS gives it, about once per second:

- the **speed** of the phone,
- its **altitude**,
- an **accuracy** estimate for both.

From these, and a few numbers describing the vehicle, the app rebuilds the rest step by step:

1. **Forces → power.** Speed, slope and acceleration give the forces on the vehicle: air drag, tyre rolling resistance, gravity on slopes, and the extra force needed to speed up. Their sum times the speed gives the power the wheels must deliver.
2. **Power → fuel.** A simple engine model turns that power into litres per hour.
3. **Fuel → cost and CO₂.** Litres × price gives the cost. Litres × a constant per fuel gives the CO₂.

Each step is a physical model with a few parameters. The sections below explain each model, where its parameters come from, and how the noisy GPS data is cleaned before it is used.

---

## 2. How is the power calculated?

**The force.** Along the road, the wheels must push with a force $F$ that balances everything resisting the motion and, on top of that, changes the vehicle's speed. 

Newton's second law $F = m\cdot a$ + (resistances), rearranged:

$$
F = \underbrace{\lambda\, m\, a}_{\text{inertia}} \;+\; \underbrace{m g \sin\theta}_{\text{slope}} \;+\; \underbrace{m g\, C_{rr}}_{\text{rolling}} \;+\; \underbrace{\tfrac12 \rho\, C_dA\, v^2}_{\text{air drag}}
$$

| Term | What it is |
| --- | --- |
| **Inertia** $\lambda m a$ | Force to change the speed. $\lambda \approx 1.05$ accounts for wheels, shafts and engine parts, which must also spin faster: they act like ~5% extra mass. |
| **Slope** $m g \sin\theta$ | Component of the weight along the road (section 7). |
| **Rolling** $m g C_{rr}$ | Tyre deformation losses. $C_{rr} \approx 0.010$: about 1% of the weight, independent of speed. |
| **Drag** $\frac{1}{2} \rho C_dA v^2$ | Air resistance (section 5). |

- $\boldsymbol{F}$ [N]: force the wheels push with, along the road (the result)
- $\boldsymbol{m}$ [kg]: mass of the vehicle with its occupants (preset or registration document, + 75 kg per passenger)
- $\boldsymbol{a}$ [m/s²]: acceleration of the car (from GPS speed, section 6)
- $\boldsymbol{\lambda}$ [–]: rotating-mass factor (1.05)
- $\boldsymbol{g}$ [m/s²]: gravitational acceleration (9.81)
- $\boldsymbol{\theta}$ [rad]: road angle from the horizontal, positive uphill (from GPS altitude, section 7)
- $\boldsymbol{C_{rr}}$ [–]: rolling-resistance coefficient (0.010)
- $\boldsymbol{\rho}$ [kg/m³]: air density (1.2)
- $\boldsymbol{C_dA}$ [m²]: drag area, drag coefficient × frontal area (by vehicle type, section 5)
- $\boldsymbol{v}$ [m/s]: speed (from GPS, section 6)

Why **$\lambda$**? To speed the car up, the engine must give kinetic energy both to the moving mass, $\frac{1}{2} m v^2$, and to every part that spins: wheels, brake discs, shafts, gears and the engine's own crankshaft and flywheel. A part with moment of inertia $I$ spinning at angular speed $\omega$ stores $\frac{1}{2} I \omega^2$. For a wheel of radius $r$, $\omega = v/r$, so its energy is $\frac{1}{2} \frac{I}{r^2} v^2$: it behaves like an extra mass $I/r^2$. Engine parts turn faster than the wheels by the gear ratio $n$, so their equivalent mass is multiplied by $n^2$. Adding all of these to $m$ gives an effective mass $\lambda m$. $\lambda$ is largest in low gears (1.1–1.4 in first gear) and close to 1.03–1.05 in top gear. The model uses a constant $\lambda = 1.05$.

**The power.** Power is the rate at which a force does work. Over a very short stretch $dx$, covered in a time $dt$, the force $F$ can be taken as constant and it does work $dW = F\,dx$ (all forces here act along the road). So, at every instant,

$$
P = \frac{dW}{dt} = F\,\frac{dx}{dt} = F \cdot v
$$

The same force costs more power at a higher speed, because it acts over more metres each second. At $v = 0$ the power is zero, whatever the force: a car held still on a slope does no work on it (the engine may still burn fuel at idle, see section 3). The power $P$ is what the wheels must deliver; the engine model then turns it into fuel.


**Three consequences worth remembering**

- **Drag power grows as $v^3$.** Doubling the speed doubles the momentum the car gives to each air molecule it hits *and* the number of molecules it hits per second, so the drag force grows as $v^2$; the power is that force times $v$ again. **Going from 100 to 130 km/h needs about twice the drag power**. This is why motorway driving is expensive.
- **The slope term is large.** On a 5% climb the slope force is 5% of the weight: five times the rolling force, and for a typical car at 100 km/h more than rolling and drag together. At the same speed the power more than doubles.
- **$P$ can be negative.** When the car slows down ($a < 0$) or goes downhill ($\theta < 0$), the momentum or gravity does the work, and the engine needs to deliver nothing. Section 3 explains what the engine does then.

The rolling term should strictly be multiplied by $\cos\theta$ (only the weight component *into* the road presses the tyres), but on a 15% road $\cos\theta = 0.989$, so the difference is negligible.

Implemented in `app/model.js` (`tractivePower`).

---

## 3. How is power turned into fuel?

**Idea.** An engine burns some fuel just to keep itself running (idle), and every extra kilowatt delivered costs a roughly constant extra amount of fuel. That is a linear function, known as the **Willans line**:

$$
f = f_0 + k \cdot P_{\text{kW}} \qquad (P > 0)
$$

- $f$ is the fuel flow in litres per hour.
- $f_0$ is the **idle** fuel flow to keep the engine running.
- $k$ is the line's **slope**: litres per hour for each extra kW.

**Where $k$ comes from physically.** A litre of gasoline holds about 32 MJ ≈ 8.9 kWh of chemical energy. An engine converts about 30% of it to mechanical work, and the gearbox loses a little more, so each litre delivers about 2.6 kWh at the wheels: $k \approx 1/2.6 \approx 0.38$ L/kWh. Typical values are 0.35–0.45 for gasoline and 0.30–0.33 for diesel (more efficient engines, denser fuel). LPG holds less energy per litre, so $k$ is higher (~0.54).

**What happens when no power is needed ($P \le 0$)**

| Situation | Fuel | Why |
| --- | --- | --- |
| Stopped (v < 0.5 m/s) | f₀, or 0 with start-stop | Engine idles or is switched off. |
| P ≤ 0, above 20 km/h | 0 | Modern engines cut injection when the wheels drive the engine (engine braking): coasting in gear is free. |
| P ≤ 0, below 20 km/h | f₀ | At low engine speed the cut-off ends, to avoid stalling. |
| P > 0 | f₀ + k·P | The Willans line. |

Before any of this, the power is clamped to $\pm P_{max}$ (the wheel power the engine can actually deliver), so that a GPS glitch cannot produce an impossible value.

**What this model leaves out.** Gears and engine speed, so the efficiency differences between, say, 2nd gear at high revs and 6th gear at low revs are averaged into $k$. No energy recovery: a hybrid's regenerative braking is out of scope, so descents are "free" but never "negative".

**Air conditioning.** When A/C is switched on in the app, a fixed extra load (1–2 kW for cars) is added to $P$ before the Willans line.

Implemented in `app/model.js` (`fuelRate`).

---

## 4. How is CO₂ emission estimated?

**Idea.** Fuel is a hydrocarbon. When it burns completely, every carbon atom ends up in a CO₂ molecule. A litre of a given fuel contains a fixed mass of carbon, so it always produces the same mass of CO₂:

$$
m_{CO_2} = \text{litres} \times c_{\text{fuel}}
$$

| Fuel | c (kg CO₂ per litre) |
| --- | --- |
| Gasoline | 2.31 |
| Diesel | 2.64 |
| LPG | 1.6 |

**Where 2.31 comes from (gasoline).** One litre weighs about 0.74 kg and is about 85% carbon by mass: 0.63 kg of carbon. Each carbon atom (12 g/mol) becomes one CO₂ molecule (44 g/mol), so the mass is multiplied by $\frac{44}{12} \approx 3.67$: $0.63 \times 3.67 \approx 2.3$ kg. Diesel is denser, so a litre holds more carbon. LPG is lighter, so each litre gives less CO₂.

**To give the number a meaning,** the trip summary compares it with the time a typical mature tree needs to absorb it (about 20 kg of CO₂ a year, a rough figure: real trees range from ~10 to several hundred kg).

**Limits.** Only the CO₂ from burning the fuel ("tank to wheel"). The emissions of extracting, refining and transporting the fuel are not counted.

Implemented in `app/model.js` (`co2FromFuel`, `treeDays`).

---

## 5. How is drag estimated?

**Idea.** A moving car must push aside the air in front of it. In one second it sweeps a volume $A v$ (frontal area × speed), of mass $\rho A v$, and accelerates it to a speed comparable to $v$. The momentum given to the air per second, which is the force, therefore scales as $\rho A v^2$. The dimensionless **drag coefficient** $C_d$ collects everything about the shape:

$$
F_{\text{drag}} = \tfrac12\, \rho\, C_d\, A\, v^2
$$

- $\rho = 1.2$ kg/m³: air density at sea level and ~20 °C.
- $C_d$ and $A$ always appear together, so the app uses their product, the **drag area** $C_dA$ (m²). It is the area of a flat plate that would have the same drag.

**Where the app gets $C_dA$.** Measuring it needs a wind tunnel or careful coast-down tests, and it is not printed on any document. Makers and car magazines often publish it, or publish $C_d$ and the frontal area $A$ separately, so the advanced settings accept a typed $C_dA$. Without one, the app uses typical values by body type:

| Vehicle | C_dA (m²) |
| --- | --- |
| City car | 0.60 |
| Hatchback / sedan | 0.65 |
| Estate | 0.70 |
| SUV | 0.90 |
| Van | 1.10 |
| Scooter / motorcycle (with rider) | 0.40 / 0.35 |

**How much it matters.** At city speeds drag is small next to inertia and rolling. Above ~70 km/h it becomes the largest steady force, and at 130 km/h it is typically 70–80% of the load. An error of 10% in $C_dA$ is therefore an error of up to ~8% in motorway fuel.

The remaining error in $C_dA$ is partly absorbed by the calibration of $k$ (section 9).

**What the model ignores.** Wind (the relevant speed is relative to the air, not the road), changes in air density with altitude and temperature (~10% less dense at 1000 m), open windows, roof boxes.

---

## 6. How is acceleration measured?

**Where the speed comes from.** The GPS chip measures speed directly, from the **Doppler shift** of the satellite signals: the phone's motion slightly changes the frequency it receives from each satellite. This speed is much more precise (typically a few tenths of m/s) than a speed derived from two successive positions, whose errors of several metres would be divided by one second. The app uses the chip's speed whenever it is available and falls back to position differences only when it is not.

**From speed to acceleration.** The acceleration is the change in speed between two readings divided by the time between them:

$$
a_{\text{raw}} = \frac{v_i - v_{i-1}}{t_i - t_{i-1}}
$$

A numerical derivative amplifies noise: a speed error of 0.3 m/s over 1 s becomes an acceleration error of 0.3 m/s², which for a 1.5 t car at 50 km/h is about 6 kW. So two safeguards are applied:

1. **Clamp** to ±6 m/s². A normal car rarely exceeds 3–4 m/s² accelerating or 8–9 m/s² in an emergency stop. Values beyond the clamp are glitches.
2. **Light smoothing** with a time constant of 1 s (the filter is explained in Appendix A). This removes most of the jitter while still following a real acceleration within a couple of seconds.

**Why the energy still comes out right.** The inertia power $\lambda \cdot m \cdot a \cdot v$ is the rate of change of kinetic energy. Over an acceleration followed by a braking, the positive and negative parts cancel, except that the engine cannot recover energy (section 3). Small errors in $a$ therefore mostly cancel out over a trip; what matters is the shape (when the engine is working and when it is coasting).

**No accelerometer.** The phone's accelerometer could measure acceleration directly, but only if the phone's axes were aligned with the car's. A phone in a holder, or on a leaning motorcycle, makes that unreliable. The app uses GPS only.

---

## 7. How are slopes measured?

**Idea.** A slope is altitude rise over distance travelled. The GPS speed is the *horizontal* component of the velocity, so integrating it over time, $d = \sum v\,\Delta t$, gives the horizontal distance. If the car climbs $\Delta h$ (from the GPS altitude) while it covers a horizontal distance $d$:

$$
\tan\theta = \frac{\Delta h}{d}, \qquad \theta = \arctan\frac{\Delta h}{d}
$$

This is the road-sign grade (a 20% sign means $\tan\theta = 0.20$). The slope force needs $\sin\theta$, which the app takes from the angle. The two are close on ordinary roads and drift apart on steep ones:

| Grade ($\tan\theta$) | $\sin\theta$ | Difference |
| --- | --- | --- |
| 5% | 4.99% | 0.1% |
| 10% | 9.95% | 0.5% |
| 20% | 19.6% | 2% |
| 25% (largest accepted) | 24.3% | 3% |

**The problem: GPS altitude is noisy.** The satellites are all above the phone, so the vertical position is poorly constrained, and the altitude error is typically 2–3 times the horizontal one: several metres. A 3 m error over 10 m of road would read as a 30% slope. So the slope is built in four stages:

1. **Minimum distance (50 m).** A new slope is computed only after at least 50 m of road. A 3 m error then gives at most 6%, which the next stages reduce further.
2. **Clamp at ±25%.** Steeper roads are extremely rare (motorways stay under 8%, mountain roads reach 15–20%). Anything above is a glitch.
3. **Smoothing over distance.** Successive raw slopes are averaged with an exponential filter whose length is set in metres of road, not seconds (Appendix A explains the filter). A slope belongs to a place on the road, not to a moment. The length is about four GPS readings' worth of road, bounded between 32 m in town (so short hills are not flattened) and 150 m on the motorway (where more noise needs averaging). The price is a lag: the displayed slope trails the real one by a few seconds.
4. **Believability check.** Between two readings, the altitude cannot change by more than 25% of the distance driven plus a few metres of noise. A larger change is the GPS correcting itself, not the road. After such a jump, or when the GPS has just started, the altitude is not trusted until it moves by a believable amount while driving. While it is not trusted, the app treats the road as flat and shows "–" for the slope.

**When the car is stopped,** each new altitude reading becomes the new starting point. A stopped car covers no distance, so a drifting altitude at a traffic light would otherwise turn into a false slope when it moves off.

**How much accuracy is needed.** A 1% slope error is a force error of 1% of the weight, as large as the whole rolling force: for a typical car at 100 km/h, about a third of the flat-road load. Slope is the least precise input of the model, which is why it is filtered so heavily. Over a whole hill, **the filtering does not change the total height gained, so the energy of the climb is about right even when the instantaneous reading lags**.

Implemented in `app/model.js` (`slopeFromAltitude`, `smoothSlope`, `slopeLength`, `altitudeStep`) and `app/app.js`.

---

## 8. How is the GPS signal treated, and why?

Raw GPS readings arrive at irregular intervals (about 1 s), with random noise, occasional jumps, and sometimes gaps of several seconds (tunnels, buildings). The app handles this at three levels.

### Accuracy bands: should this reading be used?

Each reading carries an estimated horizontal accuracy.

| Accuracy | What the app does |
| --- | --- |
| ≤ 5 m | Full use: speed, acceleration, altitude and slope. |
| 5–20 m | The speed (Doppler) is still good, so distance and fuel totals continue. The altitude is not used, and the display is frozen in grey. |
| > 20 m | The reading is ignored; nothing is integrated across the bad stretch. |

**Gaps.** If more than 5 s pass between two readings (for example in a tunnel), the app does not integrate across them (it does not know what happened in between). It restarts from the next reading.

### The smoothing filter

All smoothing in the app uses the same filter, an **exponential moving average** with a time constant $\tau$ (Appendix A explains it). A small $\tau$ follows quickly but lets noise through; a large $\tau$ is steady but late.

| Quantity | τ | Why |
| --- | --- | --- |
| Acceleration | 1 s | Must react fast: it decides when the engine works or coasts. |
| Displayed fuel rate and speed | 2 s | A readable display that still responds within a few seconds. |
| Displayed altitude | 5 s | Display only. |
| Slope | ~4 readings of road (32–150 m) | Very noisy input; smoothed over distance (section 7). |

### Two rules that keep the totals honest

- **Smooth the numerator and the denominator separately.** The per-kilometre cost is fuel rate ÷ speed. Near a standstill the speed tends to zero and the ratio explodes. Smoothing the fuel rate and the speed separately, and then dividing, keeps the display stable.
- **The totals skip the display smoothing.** At each reading the app computes the fuel rate $f$ from the raw speed, the smoothed acceleration and the smoothed slope, and adds $f\,\Delta t$ to the trip fuel (distance adds $v\,\Delta t$). The 2 s smoothing of the displayed fuel rate and speed is applied only to what is shown, so it never changes how much fuel the trip used.

Implemented in `app/model.js` (`smooth`), `app/gps.js` and `app/app.js`.

---

## 9. How does the app use the car's registration document?

The **advanced settings** read a few fields from the registration certificate. Each fills one parameter of the model.

| Field | Meaning | Becomes |
| --- | --- | --- |
| **G** (or G.1 + 75 kg) | Mass in running order, with driver | Mass *m* |
| **F.1** | Maximum laden mass | Test mass of the official test (below) |
| **P.1** | Engine capacity | Idle fuel: f₀ ≈ 0.5 L/h per litre of capacity |
| **P.2** | Maximum engine power | Power clamp: P_max = 0.9 × P.2 (≈10% lost in the transmission) |
| Body type | Hatchback, SUV, … | Drag area *C_dA* (table in section 5), unless typed |
| CdA (optional, not on the document) | Drag area, found online | Drag area *C_dA*, replacing the body-type value |
| **V.7** | Official CO₂, g/km | Official consumption, used to calibrate *k* |

### The official test (WLTP)

Since 2017, new cars in the EU are measured with the **WLTP** procedure. The car sits on rollers in a laboratory and is driven along a fixed speed-versus-time curve, the **WLTC**: 30 minutes, 23.3 km, from town stop-and-go to 131 km/h. The exhaust CO₂ is measured and divided by the distance: that is the V.7 figure. By section 4, it is also the official fuel consumption.

The car is tested at a defined **test mass**: the mass in running order, plus 25 kg, plus 15% of the remaining payload up to the maximum laden mass. This is why F.1 is useful.

### Calibrating $k$

The engine's efficiency, $k$, is the parameter the app knows least. The certificate fixes it indirectly:

1. Convert V.7 into the official consumption in L/100 km, and multiply by **1.15**, because real driving typically uses 10–25% more than the laboratory figure.
2. Run the app's own model over the WLTC speed curve, second by second, with this car's mass, drag area, idle fuel and power limit: the same calculation as during a real trip, on a flat road without A/C.
3. Find the $k$ for which the simulated consumption equals the target.

Step 3 needs no trial and error. Over the cycle, every second with positive power adds $f_0 + k P$, and every other second does not depend on $k$. So the total fuel is a **straight line in $k$**, $L(k) = A + B k$. Two simulations ($k = 0$ and $k = 1$) give $A$ and $B$, and then

$$
k = \frac{\text{target} - A}{B}
$$

**What this gives and what it does not.** The model now reproduces this car's certified consumption, instead of using one value for all cars of a fuel. But $k$ also silently absorbs the errors of every other fixed number (rolling resistance, drag area, air density), so it is a fitted constant, not a measured efficiency. Agreement with the certificate proves nothing about the model on the road; only real drives can show that.

**Motorcycles and scooters.** Their certificates follow a different regulation: the mass in running order does **not** include the rider, so the app adds 75 kg. Without G, the mass is estimated from the maximum laden mass minus the passenger (65 kg). Their documents carry no WLTP figure, so $k$ comes from the user's own average (section 10).

**Your own average consumption instead of V.7.** If the user also enters their real average consumption (section 10), it replaces V.7 as the target of the calibration: the same simulation is run and $k$ is solved so that the model reproduces that average. No ×1.15 factor is applied, because a real average already includes real driving. Mass, drag area, idle fuel and power limit still come from the certificate. This is the preferred source for $k$: it reflects how this car is actually driven, while V.7 is a laboratory figure corrected by a generic factor.

Implemented in `app/model.js` (`consumptionFromCo2`, `testMass`, `simulateCycle`, `calibrateK`), `app/profile.js` and `app/wltc.js` (the WLTC speed curve, from Regulation (EU) 2017/1151).

---

## 10. What if the advanced settings are not available?

The app still works, with less precise parameters.

**Quick presets.** The user picks a vehicle type, and the app uses typical values:

| Vehicle | Mass (kg, with driver) | C_dA (m²) | f₀ (L/h) | A/C load |
| --- | --- | --- | --- | --- |
| City car | 1100 | 0.60 | 0.6 | 1.0 kW |
| Sedan | 1500 | 0.65 | 0.8 | 1.5 kW |
| SUV | 2000 | 0.90 | 1.0 | 2.0 kW |
| Van | 2500 | 1.10 | 1.2 | 2.0 kW |
| Scooter | 175 | 0.40 | 0.25 | – |
| Motorcycle | 300 | 0.35 | 0.4 | – |

$k$ is the generic value for the fuel (0.45 gasoline, 0.33 diesel, 0.54 LPG), and each passenger adds 75 kg. The expected error is about ±20–30%, mostly from $k$.

**Your own average consumption.** This is the best single improvement, and it needs no document. The user enters their real average (for example from a full-tank to full-tank calculation: litres ÷ km × 100). The app runs the same calibration as in section 9, using the WLTC only as a generic mix of town, road and motorway, and solves for the $k$ that reproduces this average. No ×1.15 factor is applied, because a real average already includes real driving.

**Example: measuring your average.**

1. Fill the tank completely, until the pump stops.
2. Reset the trip odometer to 0.
3. Drive as usual, ideally for most of a tank, so that small differences in how full the tank is count for little.
4. Read the distance on the trip odometer: say 612 km.
5. Fill the tank completely again, and read the litres on the pump: say 38.4 L. That is the fuel the car used for those 612 km.
6. In the app, tap **Calc** next to the average consumption field and enter the litres and the kilometres. The app computes $38.4 / 612 \times 100 = 6.27$ L/100 km and puts it in the field.

The order of preference for $k$ is: your own average, then the certificate (V.7 × 1.15), then the generic value.

**Limit of a single number.** One average fixes the overall level of consumption, not the shape. If the user's driving is very different from the WLTC mix, the estimate shifts. For small engines (motorcycles) the fitted $k$ comes out large (~0.9 L/kWh), because a small engine at light load is inefficient and the straight Willans line puts all of that into $k$: the average fits, but hard accelerations are probably over-penalised.

---

## 11. How is the driving style rated?

**Idea.** Every drive has accelerations and stops that the route imposes: traffic lights, junctions, bends. What the driver controls is *how* they are taken, and how fast they cruise. To separate the two, the app imagines a **calm driver** on the same route: one who stops and starts in the same places, but accelerates and brakes gently and never cruises above an efficient speed.

**The calm driver.** Its speed is the real speed passed through the exponential filter of Appendix A with a time constant of 5 s, then capped:

$$
v_{\text{calm}}(t) = \min\Big(\text{smooth}\big(v(t),\ \tau = 5\ \text{s}\big),\ v_{\text{cap}}\Big)
$$

with $v_{\text{cap}}$ = 90 km/h for cars and motorcycles, and 50 km/h for scooters, which are meant for town and the roads around it. A sharp acceleration from 30 to 70 km/h in 5 s becomes, for the calm driver, a gradual one over about 15 s; a long stop stays a stop. The calm driver's acceleration is the rate of change of $v_{\text{calm}}$, and its fuel is computed with the same model, the same slopes and the same A/C load as the real drive. So hills cancel out: both drivers climb the same ones.

**Two ways to waste fuel.**
- **Hard accelerations.** The kinetic energy put in during an acceleration, $\frac{1}{2} m v^2$, is mostly lost in the brakes at the next stop, and short bursts of high power are what the calm driver avoids.
- **High speed.** Air drag grows with $v^2$, so above the cap every kilometre costs more: cruising at 130 km/h instead of 90 km/h takes about 40–60% more fuel per kilometre.

The app measures the two separately, with a second shadow that is smoothed but not capped. Per kilometre:

$$
\underbrace{\frac{\text{real}}{\text{calm}}}_{r} \;=\; \underbrace{\frac{\text{real}}{\text{smoothed}}}_{\text{accelerations}} \;\times\; \underbrace{\frac{\text{smoothed}}{\text{calm}}}_{\text{speed}}
$$

**The marks.** Each part gets a mark out of 5. It scores 5/5 when it costs no more fuel than the calm driver, and loses one point for every 10% of extra fuel, down to 0/5 at +50%:

$$\text{mark} = \operatorname{round}\Big(5\,\big(1 - \tfrac{\max(0,\ \text{factor} - 1)}{0.5}\big)\Big), \quad \text{at least } 0.$$

**The badge.** It is set by the sum of the two marks, from 0 to 10:

| Sum of the marks | Driving style |
| --- | --- |
| 9 or 10 | Eco |
| 7 or 8 | OK |
| 5 or 6 | Brisk |
| 4 or less | Bad |

The summary shows the badge and both marks, for example "OK: accelerations 3/5 · speed 5/5", so the driver knows what to change. Trips shorter than 1 km get no badge.

**The thresholds are provisional.** They will be checked on drives that their drivers label calm, normal or brisk, possibly with separate settings for two-wheelers.

**Limits.**
- Without a map the app does not know the speed limit: the cap is an efficient speed, not the legal one, so a legal 130 km/h on the motorway still shows a speed cost.
- A needless stop is not penalised, because the calm driver stops too.
- It is a model figure: the extra fuel is what the model attributes to the accelerations and the speed, not a measurement. It also depends on the vehicle settings (a heavier vehicle pays more for each acceleration).

Implemented in `app/model.js` (`driveQuality`, `styleFactors`, `CALM_TAU`) and `app/app.js`.

---

## 12. Summary of the main approximations

| Approximation | Effect |
| --- | --- |
| Willans line (straight line, no gears) | Fuel at a given power is an average over gears and engine speeds. |
| Constant C_rr, ρ, λ | No tyre pressure, temperature or altitude effects. Partly absorbed by *k*. |
| C_dA from a table | ±10–20% on drag. Partly absorbed by *k*. |
| No wind | Head or tail wind changes motorway fuel noticeably. |
| GPS slope, heavily smoothed | Lags on short hills; a stale altitude reads as a flat road. |
| No cold-start correction | Short trips with a cold engine are underestimated. |
| No energy recovery | Not suited to hybrids or electric vehicles. |
| Tank-to-wheel CO₂ only | Fuel production emissions not counted. |

---

## Appendix A. The exponential filter

Every smoothed quantity in the app (acceleration, displayed fuel rate and speed, altitude, slope) goes through the same filter. This appendix derives it and shows what it does to a signal.

### From a differential equation to the update rule

Let $x(t)$ be the raw signal and $s(t)$ the smoothed one. Ask $s$ to move towards $x$ at a rate proportional to the gap between them:

$$
\frac{ds}{dt} = \frac{x - s}{\tau}
$$

This is the equation of an RC low-pass filter (with $\tau = RC$), or of a cup of coffee cooling towards room temperature. $\tau$ is the **time constant**: the larger it is, the more slowly $s$ follows.

GPS readings arrive at discrete times. Between two readings, take $x$ constant, equal to the new reading. The equation then has an exact solution over the interval $\Delta t$:

$$
s(t + \Delta t) = x + \big(s(t) - x\big)\, e^{-\Delta t/\tau}
$$

The gap between $s$ and $x$ shrinks by the factor $e^{-\Delta t/\tau}$. Rearranged, this is the update rule the app applies at each reading:

$$
s_{\text{new}} = s_{\text{old}} + \alpha\,(x - s_{\text{old}}), \qquad \alpha = 1 - e^{-\Delta t/\tau}
$$

Because the rule is the exact solution and not an approximation, the result does not depend on how the time is cut up. Two intervals $\Delta t_1$ and $\Delta t_2$ with the same reading shrink the gap by $e^{-\Delta t_1/\tau}\, e^{-\Delta t_2/\tau} = e^{-(\Delta t_1 + \Delta t_2)/\tau}$, the same as one interval of $\Delta t_1 + \Delta t_2$. This matters because GPS readings do not arrive at a perfectly regular rate. A fixed $\alpha$ would smooth more when readings come fast and less when they come slowly.

### What it remembers: an exponentially weighted average

With a constant interval, apply the rule repeatedly and expand:

$$
s_n = \alpha \left[ x_n + (1-\alpha)\, x_{n-1} + (1-\alpha)^2\, x_{n-2} + \dots \right]
$$

The smoothed value is a weighted average of all past readings. The weights decrease geometrically with age: a reading $T$ seconds old has weight proportional to $e^{-T/\tau}$, and the weights add up to 1. Recent readings count most, old ones fade out and are never cut off abruptly. The filter stores a single number, $s$, whatever the length of its memory. That is why it is preferred to a moving average over a fixed window, which needs to keep every reading in the window and handles irregular intervals poorly.

### Three ways to see the trade-off

**Step response.** If the true value jumps from 0 to 1 and stays there:

$$
s(t) = 1 - e^{-t/\tau}
$$

| Time after the jump | $\tau$ | $2\tau$ | $3\tau$ | $5\tau$ |
| --- | --- | --- | --- | --- |
| Share of the jump reached | 63% | 86% | 95% | 99% |

**Lag on a steady change.** If the true value rises steadily, $x = r\,t$ (for example a car accelerating evenly), the smoothed value settles at $s = r\,(t - \tau)$. It follows the right trend, but $\tau$ seconds late. With $\tau = 2$ s, the displayed fuel rate shows what was happening 2 s earlier.

**Noise reduction.** If each reading carries independent random noise with standard deviation $\sigma$, the noise left in $s$ has standard deviation

$$
\sigma_s = \sigma \sqrt{\frac{\alpha}{2 - \alpha}} \;\approx\; \sigma \sqrt{\frac{\Delta t}{2\tau}} \quad (\Delta t \ll \tau)
$$

With one reading per second, $\tau = 2$ s gives $\alpha = 0.39$ and $\sigma_s \approx 0.49\,\sigma$: the noise is halved. Halving it again needs a $\tau$ about four times longer, and so a lag four times longer. Less noise always costs more delay.

**In terms of frequencies,** the filter lets slow changes through and damps fast ones. The dividing line is the cut-off frequency $f_c = 1/(2\pi\tau)$. For $\tau = 2$ s that is 0.08 Hz: changes lasting more than about 10 s pass almost unchanged, while second-to-second jitter is strongly reduced.

### The same filter over distance

For the slope, time is replaced by distance travelled and $\tau$ by a length $L$:

$$
\alpha = 1 - e^{-d/L}
$$

where $d$ is the distance since the last update. Everything above carries over with metres in place of seconds: after $L$ metres a change in the road is 63% reflected, after $3L$ metres 95%. At standstill no distance accumulates, so the slope is held rather than drifting.

Implemented in `app/model.js` (`smooth`, `smoothSlope`).
