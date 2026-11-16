# Birdbrain

A playable Flappy Bird-inspired game and in-browser reinforcement-learning lab. Fly by
clicking/tapping the game or pressing **Space**. Use **Take the controls** to
start a manual flight, or **Train the agent** to watch the policy learn.

## Run locally

```powershell
npm install
npm run dev
```

The training loop animates a configurable group of birds in one shared world:
they start together, sense the next pipe's distance and gap alongside their
own height and vertical speed, and have independent bird physics and
action-sampling streams. Training starts from a random policy and uses wider
gaps for the first two groups, then gradually narrows them to the normal game
gap by round nine; the first four rounds share a starter layout before groups
switch to fresh layouts. A tabular Q learner maps the bird's gap-relative height,
vertical speed, pipe distance, and gap width to flap/no-flap action values.
Every bird greedily chooses the action with the highest Q value plus a visit
bonus for less-tried actions; the bonus increases after reaching 75% of the
training high score. Randomized, staggered starting positions keep flight
paths from stacking exactly on top of each other while sampling more of the
game space. Birds start in a grid at different heights and pipe distances.
Every trajectory updates the shared Q table with bootstrapped state-action
values, so all birds contribute to learning. Survival and gap-alignment
rewards provide feedback before the first pipe is passed.
Normal training advances one
simulation step at a time; the separate **Train 10×** button runs ten
simulation steps per frame. The live sensor readout shows what an active bird
observes. The updated Q table, round number, and recent returns are saved
locally so training continues across page reloads.

Your best score is also saved in browser local storage.
