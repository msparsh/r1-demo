export const WIDTH = 800;
export const HEIGHT = 600;
export const GROUND_Y = 520;

const BIRD_X = 224;
const BIRD_RADIUS_X = 18;
const BIRD_RADIUS_Y = 11;
const PIPE_WIDTH = 78;
const PIPE_GAP = 154;
const MIN_PIPE_SPACING = 220;
const MAX_PIPE_SPACING = 340;
const DIFFICULT_GAP_AMPLITUDE = 46;
const DIFFICULT_GAP_SPEED = 0.05;
const GRAVITY = 0.39;
const FLAP_VELOCITY = -7.3;
const TERMINAL_VELOCITY = 8.5;
const EXPLORATION_SCORE_FRACTION = 0.75;
const BASE_EXPLORATION_BONUS = 8;
const HIGH_SCORE_EXPLORATION_BONUS = 16;
const INITIAL_EXPLORATION_RATE = 0.04;
const EXPLORATION_DECAY_STEPS = 60;
const HEIGHT_BUCKETS = 9;
const VELOCITY_BUCKETS = 7;
const DISTANCE_BUCKETS = 4;
const GAP_WIDTH_BUCKETS = 3;
const Q_ACTION_COUNT = 2;
const Q_STATE_COUNT = HEIGHT_BUCKETS * VELOCITY_BUCKETS * DISTANCE_BUCKETS * GAP_WIDTH_BUCKETS;
export const Q_VALUE_COUNT = Q_STATE_COUNT * Q_ACTION_COUNT;

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function getNextPipeX(lastPipe, random) {
  return lastPipe.x + MIN_PIPE_SPACING + random() * (MAX_PIPE_SPACING - MIN_PIPE_SPACING);
}

function updatePipeGaps(pipes, frame, difficultMode) {
  for (const pipe of pipes) {
    const baseGapY = pipe.baseGapY ?? pipe.gapY;
    pipe.gapY = difficultMode
      ? clamp(
          baseGapY +
            Math.sin(frame * DIFFICULT_GAP_SPEED + (pipe.motionPhase ?? 0)) *
              DIFFICULT_GAP_AMPLITUDE,
          pipe.gap / 2 + 20,
          GROUND_Y - pipe.gap / 2 - 30,
        )
      : baseGapY;
  }
}

function observationIndex(observation) {
  const height = clamp(
    Math.floor(((clamp(observation[0], -0.55, 0.55) + 0.55) / 1.1) * HEIGHT_BUCKETS),
    0,
    HEIGHT_BUCKETS - 1,
  );
  const velocity = clamp(
    Math.floor(((clamp(observation[1], -1, 1) + 1) / 2) * VELOCITY_BUCKETS),
    0,
    VELOCITY_BUCKETS - 1,
  );
  const distance = clamp(
    Math.floor((clamp(observation[2], 0, 1.2) / 1.2) * DISTANCE_BUCKETS),
    0,
    DISTANCE_BUCKETS - 1,
  );
  const gapWidth = observation[4] - observation[3];
  const gap = gapWidth > 0.35 ? 2 : gapWidth > 0.29 ? 1 : 0;
  return ((height * VELOCITY_BUCKETS + velocity) * DISTANCE_BUCKETS + distance) *
    GAP_WIDTH_BUCKETS + gap;
}

export function createPolicy() {
  return {
    qValues: Array(Q_VALUE_COUNT).fill(0),
    visits: Array(Q_VALUE_COUNT).fill(0),
  };
}

export function policyAction(policy, observation) {
  const stateIndex = observationIndex(observation);
  const noFlapValue = policy.qValues[stateIndex * Q_ACTION_COUNT];
  const flapValue = policy.qValues[stateIndex * Q_ACTION_COUNT + 1];
  if (noFlapValue === flapValue) return Math.random() < 0.5 ? 1 : 0;
  return flapValue > noFlapValue ? 1 : 0;
}

export function createGame(seed = Date.now()) {
  const random = randomGenerator(seed);
  const firstGap = 168 + random() * 180;
  return {
    status: "ready",
    score: 0,
    bird: { x: BIRD_X, y: 270, vy: 0 },
    pipes: [
      {
        x: WIDTH + 40,
        gapY: firstGap,
        baseGapY: firstGap,
        motionPhase: random() * Math.PI * 2,
        gap: PIPE_GAP,
        scored: false,
      },
    ],
    randomState: seed >>> 0,
    random,
    flap: false,
    frames: 0,
  };
}

export function getObservation(game) {
  const bird = game.bird;
  const nextPipe = game.pipes.find((pipe) => pipe.x + PIPE_WIDTH >= bird.x) ?? game.pipes[game.pipes.length - 1];
  const pipe = nextPipe ?? { x: WIDTH + 40, gapY: 270, gap: PIPE_GAP };
  const gapTop = pipe.gapY - pipe.gap / 2;
  const gapBottom = pipe.gapY + pipe.gap / 2;
  return [
    (bird.y - pipe.gapY) / HEIGHT,
    bird.vy / TERMINAL_VELOCITY,
    (pipe.x - bird.x) / WIDTH,
    gapTop / HEIGHT,
    gapBottom / HEIGHT,
  ];
}

export function stepGame(game, action, difficultMode = false) {
  if (game.status !== "playing") return 0;

  const bird = game.bird;
  let reward = 0.1;
  if (action === 1) {
    bird.vy = FLAP_VELOCITY;
    reward -= 0.05;
  } else {
    bird.vy = Math.min(bird.vy + GRAVITY, TERMINAL_VELOCITY);
  }
  bird.y += bird.vy;
  game.frames += 1;

  for (const pipe of game.pipes) pipe.x -= 2.8;
  const lastPipe = game.pipes[game.pipes.length - 1];
  if (lastPipe.x < WIDTH - 240) {
    const gapY = 165 + game.random() * 188;
    game.pipes.push({
      x: getNextPipeX(lastPipe, game.random),
      gapY,
      baseGapY: gapY,
      motionPhase: game.random() * Math.PI * 2,
      gap: PIPE_GAP,
      scored: false,
    });
  }
  updatePipeGaps(game.pipes, game.frames, difficultMode);
  game.pipes = game.pipes.filter((pipe) => pipe.x + PIPE_WIDTH > -12);

  if (bird.y < BIRD_RADIUS_Y) {
    bird.y = BIRD_RADIUS_Y;
    bird.vy = Math.max(0, bird.vy);
  }
  let collision = bird.y + BIRD_RADIUS_Y >= GROUND_Y;
  for (const pipe of game.pipes) {
    const overlapsX =
      bird.x + BIRD_RADIUS_X > pipe.x && bird.x - BIRD_RADIUS_X < pipe.x + PIPE_WIDTH;
    if (overlapsX) {
      const gapTop = pipe.gapY - pipe.gap / 2;
      const gapBottom = pipe.gapY + pipe.gap / 2;
      if (bird.y - BIRD_RADIUS_Y < gapTop || bird.y + BIRD_RADIUS_Y > gapBottom) collision = true;
    }
    if (!pipe.scored && pipe.x + PIPE_WIDTH / 2 < bird.x) {
      pipe.scored = true;
      game.score += 1;
      reward += 5;
    }
  }

  if (collision) {
    game.status = "dead";
    reward -= 10;
  }
  return reward;
}

export function createRolloutGroup(
  groupSize,
  round,
) {
  const levelSeed = round <= 4 ? 83018 : 83017 + round;
  const trainingGap =
    round <= 2 ? 230 : round <= 4 ? 205 : round <= 6 ? 185 : round <= 8 ? 170 : PIPE_GAP;
  const world = createGame(levelSeed);
  world.status = "playing";
  world.pipes[0].x = WIDTH - (round <= 4 ? 360 : 180);
  world.pipes[0].gap = trainingGap;
  world.pipes[0].id = 0;
  world.nextPipeId = 1;
  const columns = Math.min(8, groupSize);
  const rowSpacing = groupSize > 6 ? 46 : 42;
  const rows = Math.ceil(groupSize / columns);
  return {
    frame: 0,
    gap: trainingGap,
    world,
    episodes: Array.from({ length: groupSize }, (_, index) => {
      const seed = round * 7919 + index * 1013 + 17;
      const random = randomGenerator(seed);
      const variation = randomGenerator(seed ^ 0x9e3779b9);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const bird = {
        ...world.bird,
        x:
          world.bird.x +
          (column - (columns - 1) / 2) * 42 +
          (variation() - 0.5) * 14,
        y:
          world.bird.y +
          (row - (rows - 1) / 2) * rowSpacing +
          (variation() - 0.5) * 14,
        vy: (variation() - 0.5) * 1,
      };
      const game = {
        status: "playing",
        score: 0,
        bird,
        pipes: world.pipes,
      };
      return {
        game,
        random,
        steps: [],
        reward: 0,
        done: false,
        passedPipes: new Set(),
      };
    }),
  };
}

export function stepRolloutGroup(group, policy, trainingBest = 0, difficultMode = false) {
  const active = group.episodes.filter((episode) => !episode.done);
  const explorationThreshold = Math.max(1, Math.ceil(trainingBest * EXPLORATION_SCORE_FRACTION));
  for (const episode of active) {
    const observation = getObservation(episode.game);
    const stateIndex = observationIndex(observation);
    const targetPipe =
      episode.game.pipes.find((pipe) => pipe.x + PIPE_WIDTH >= episode.game.bird.x) ??
      episode.game.pipes[episode.game.pipes.length - 1];
    const explore = trainingBest > 0 && episode.game.score >= explorationThreshold;
    const explorationBonus = explore
      ? HIGH_SCORE_EXPLORATION_BONUS
      : BASE_EXPLORATION_BONUS;
    const noFlapIndex = stateIndex * Q_ACTION_COUNT;
    const flapIndex = noFlapIndex + 1;
    const noFlapValue =
      policy.qValues[noFlapIndex] +
      explorationBonus / Math.sqrt(policy.visits[noFlapIndex] + 1);
    const flapValue =
      policy.qValues[flapIndex] +
      explorationBonus / Math.sqrt(policy.visits[flapIndex] + 1);
    const greedyAction =
      flapValue === noFlapValue
        ? episode.random() < 0.5
          ? 1
          : 0
        : flapValue > noFlapValue
          ? 1
          : 0;
    const explorationProgress = Math.min(
      episode.steps.length / EXPLORATION_DECAY_STEPS,
      1,
    );
    const explorationRate = INITIAL_EXPLORATION_RATE * (1 - explorationProgress);
    const action =
      episode.random() < explorationRate
        ? 1 - greedyAction
        : greedyAction;
    policy.visits[action === 1 ? flapIndex : noFlapIndex] += 1;
    const bird = episode.game.bird;
    let reward = 1;
    if (action === 1) {
      bird.vy = FLAP_VELOCITY;
      reward -= 0.1;
    } else {
      bird.vy = Math.min(bird.vy + GRAVITY, TERMINAL_VELOCITY);
    }
    bird.y += bird.vy;
    if (bird.y < BIRD_RADIUS_Y) {
      bird.y = BIRD_RADIUS_Y;
      bird.vy = Math.max(0, bird.vy);
    }
    const gapErrorBefore = Math.abs(observation[0] * HEIGHT);
    const gapErrorAfter = Math.abs(bird.y - targetPipe.gapY);
    reward += 0.5 * (gapErrorBefore - gapErrorAfter);
    const step = { stateIndex, action, reward };
    episode.steps.push(step);
    episode.reward += reward;
  }

  const world = group.world;
  for (const pipe of world.pipes) pipe.x -= 2.8;
  const lastPipe = world.pipes[world.pipes.length - 1];
  if (lastPipe.x < WIDTH - 240) {
    const gapY = 165 + world.random() * 188;
    world.pipes.push({
      id: world.nextPipeId++,
      x: getNextPipeX(lastPipe, world.random),
      gapY,
      baseGapY: gapY,
      motionPhase: world.random() * Math.PI * 2,
      gap: group.gap,
      scored: false,
    });
  }
  updatePipeGaps(world.pipes, group.frame + 1, difficultMode);
  world.pipes = world.pipes.filter((pipe) => pipe.x + PIPE_WIDTH > -12);
  for (const episode of group.episodes) episode.game.pipes = world.pipes;

  for (const episode of active) {
    const bird = episode.game.bird;
    let collision = bird.y + BIRD_RADIUS_Y >= GROUND_Y;
    for (const pipe of world.pipes) {
      const overlapsX =
        bird.x + BIRD_RADIUS_X > pipe.x && bird.x - BIRD_RADIUS_X < pipe.x + PIPE_WIDTH;
      if (overlapsX) {
        const gapTop = pipe.gapY - pipe.gap / 2;
        const gapBottom = pipe.gapY + pipe.gap / 2;
        if (bird.y - BIRD_RADIUS_Y < gapTop || bird.y + BIRD_RADIUS_Y > gapBottom) collision = true;
      }
      if (!episode.passedPipes.has(pipe.id) && pipe.x + PIPE_WIDTH / 2 < bird.x) {
        episode.passedPipes.add(pipe.id);
        episode.game.score += 1;
        episode.reward += 50;
        episode.steps[episode.steps.length - 1].reward += 50;
      }
    }
    if (collision) {
      episode.game.status = "dead";
      episode.reward -= 10;
      episode.steps[episode.steps.length - 1].reward -= 10;
      episode.done = true;
    }
  }
  group.frame += 1;
  return group.episodes.every((episode) => episode.done);
}

function updateActionValues(policy, episodes, learningRate) {
  const rewards = episodes.map((episode) => episode.reward);
  const mean = rewards.reduce((sum, reward) => sum + reward, 0) / rewards.length;
  const variance = rewards.reduce((sum, reward) => sum + (reward - mean) ** 2, 0) / rewards.length;
  const spread = Math.sqrt(variance);
  const updates = new Map();
  for (const episode of episodes) {
    for (let index = 0; index < episode.steps.length; index += 1) {
      const step = episode.steps[index];
      const key = step.stateIndex * Q_ACTION_COUNT + step.action;
      const nextStep = episode.steps[index + 1];
      const nextValue = nextStep
        ? Math.max(
            policy.qValues[nextStep.stateIndex * Q_ACTION_COUNT],
            policy.qValues[nextStep.stateIndex * Q_ACTION_COUNT + 1],
          )
        : 0;
      const target = step.reward + (nextStep ? 0.97 * nextValue : 0);
      const update = updates.get(key) ?? { total: 0, count: 0 };
      update.total += target;
      update.count += 1;
      updates.set(key, update);
    }
  }
  for (const [index, update] of updates) {
    const target = update.total / update.count;
    policy.qValues[index] += learningRate * (target - policy.qValues[index]);
  }
  return { mean, spread, flat: false };
}

export function finishRolloutGroup(policy, group, learningRate) {
  return updateActionValues(policy, group.episodes, learningRate);
}

export function trainGroup(
  policy,
  groupSize,
  learningRate,
  round,
) {
  const group = createRolloutGroup(groupSize, round);
  let trainingBest = 0;
  while (true) {
    const complete = stepRolloutGroup(group, policy, trainingBest);
    trainingBest = Math.max(trainingBest, ...group.episodes.map((episode) => episode.game.score));
    if (complete) break;
  }
  return finishRolloutGroup(policy, group, learningRate);
}
