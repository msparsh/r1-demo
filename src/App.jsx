import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  createPolicy,
  createGame,
  createRolloutGroup,
  finishRolloutGroup,
  getObservation,
  policyAction,
  Q_VALUE_COUNT,
  stepRolloutGroup,
  stepGame,
} from "./game.js";

const WIDTH = 800;
const HEIGHT = 600;
const GROUND_Y = 520;
const TRAINING_STORAGE_KEY = "bird-training-v16";

function isFiniteArray(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function isPolicyState(value) {
  if (!value || typeof value !== "object") return false;
  return (
    isFiniteArray(value.qValues, Q_VALUE_COUNT) &&
    (value.visits === undefined || isFiniteArray(value.visits, Q_VALUE_COUNT))
  );
}

function readTrainingState() {
  const saved =
    localStorage.getItem(TRAINING_STORAGE_KEY) ??
    localStorage.getItem("bird-training-v15") ??
    localStorage.getItem("bird-training-v14");
  if (!saved) return null;

  let state;
  try {
    state = JSON.parse(saved);
  } catch (error) {
    console.warn("Could not read the saved bird policy; starting with a fresh policy.", error);
    return null;
  }

  const valid =
    (state?.version === 14 || state?.version === 15 || state?.version === 16) &&
    isPolicyState(state.policy) &&
    Number.isInteger(state.round) &&
    state.round >= 0 &&
    Array.isArray(state.rewardHistory) &&
    state.rewardHistory.every(Number.isFinite);
  if (!valid) {
    console.warn("Saved bird training data is invalid; starting with a fresh policy.");
    return null;
  }
  if (!state.policy.visits) state.policy.visits = Array(Q_VALUE_COUNT).fill(0);
  return state;
}

function saveTrainingState(current) {
  localStorage.setItem(
    TRAINING_STORAGE_KEY,
    JSON.stringify({
      version: 16,
      policy: current.policy,
      round: current.round,
      rewardHistory: current.rewardHistory,
    }),
  );
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawBird(context, bird, time, bodyColor = "#ffca62") {
  context.save();
  context.translate(bird.x, bird.y);
  context.rotate(Math.max(-0.38, Math.min(1.15, bird.vy * 0.065)));
  context.shadowColor = "rgba(36, 31, 22, .18)";
  context.shadowBlur = 12;
  context.shadowOffsetY = 5;

  context.fillStyle = bodyColor;
  context.beginPath();
  context.ellipse(0, 0, 19, 15, 0, 0, Math.PI * 2);
  context.fill();
  context.shadowColor = "transparent";

  context.fillStyle = "#f4a940";
  context.beginPath();
  context.ellipse(-5, 6 + Math.sin(time * 0.018) * 2, 10, 6, -0.3, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#fffdf3";
  context.beginPath();
  context.ellipse(8, -5, 6, 7, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#23362c";
  context.beginPath();
  context.arc(10, -5, 2.4, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#f0784d";
  context.beginPath();
  context.moveTo(15, 0);
  context.lineTo(27, 4);
  context.lineTo(15, 8);
  context.closePath();
  context.fill();
  context.restore();
}

function drawPipe(context, pipe) {
  const pipeWidth = 78;
  const cap = 11;
  const gapTop = pipe.gapY - pipe.gap / 2;
  const gapBottom = pipe.gapY + pipe.gap / 2;

  const drawBody = (x, y, width, height, capY) => {
    const gradient = context.createLinearGradient(x, 0, x + width, 0);
    gradient.addColorStop(0, "#438c62");
    gradient.addColorStop(0.32, "#78b982");
    gradient.addColorStop(0.68, "#66a873");
    gradient.addColorStop(1, "#387b55");
    context.fillStyle = gradient;
    context.fillRect(x, y, width, height);
    context.fillStyle = "rgba(255,255,255,.16)";
    context.fillRect(x + 8, y, 5, height);
    context.fillStyle = "rgba(26,77,51,.18)";
    context.fillRect(x + width - 8, y, 8, height);
    context.fillStyle = "#52996a";
    context.fillRect(x - 5, capY, width + 10, cap);
    context.fillStyle = "rgba(255,255,255,.14)";
    context.fillRect(x + 3, capY + 2, width - 6, 3);
    context.fillStyle = "rgba(33,81,53,.15)";
    context.fillRect(x - 5, capY + cap - 3, width + 10, 3);
  };

  drawBody(pipe.x, 0, pipeWidth, gapTop, gapTop - cap);
  drawBody(pipe.x, gapBottom, pipeWidth, GROUND_Y - gapBottom, gapBottom);
}

function drawScene(context, game, mode, time, best, options = {}) {
  const sky = context.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, "#b8e4d7");
  sky.addColorStop(0.67, "#e5efd0");
  sky.addColorStop(1, "#f7e9be");
  context.fillStyle = sky;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.fillStyle = "rgba(255,255,255,.48)";
  context.beginPath();
  context.arc(650, 117, 44, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255,255,255,.26)";
  context.beginPath();
  context.arc(650, 117, 61, 0, Math.PI * 2);
  context.fill();

  const cloudShift = (time * 0.012) % 960;
  for (let i = 0; i < 4; i += 1) {
    const x = ((i * 248 - cloudShift + 1000) % 1000) - 70;
    const y = 90 + (i % 3) * 72;
    context.fillStyle = "rgba(255,255,255,.55)";
    context.beginPath();
    context.ellipse(x, y, 29, 9, 0, 0, Math.PI * 2);
    context.ellipse(x + 12, y - 5, 15, 12, 0, 0, Math.PI * 2);
    context.ellipse(x - 12, y - 2, 14, 10, 0, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = "#b5d7a9";
  context.beginPath();
  context.moveTo(0, 405);
  context.quadraticCurveTo(190, 328, 380, 407);
  context.quadraticCurveTo(580, 330, 800, 398);
  context.lineTo(800, GROUND_Y);
  context.lineTo(0, GROUND_Y);
  context.fill();
  context.fillStyle = "#9bc696";
  context.beginPath();
  context.moveTo(0, 444);
  context.quadraticCurveTo(210, 385, 425, 444);
  context.quadraticCurveTo(620, 373, 800, 433);
  context.lineTo(800, GROUND_Y);
  context.lineTo(0, GROUND_Y);
  context.fill();

  for (const pipe of game.pipes) drawPipe(context, pipe);

  context.fillStyle = "#ddc78e";
  context.fillRect(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y);
  context.fillStyle = "#79b676";
  context.fillRect(0, GROUND_Y, WIDTH, 13);
  context.fillStyle = "#a0ce7d";
  for (let x = -24 + ((time * 0.06) % 24); x < WIDTH; x += 24) {
    context.beginPath();
    context.moveTo(x, GROUND_Y);
    context.lineTo(x + 8, GROUND_Y + 7);
    context.lineTo(x + 15, GROUND_Y);
    context.fill();
  }
  context.fillStyle = "rgba(149,117,65,.14)";
  for (let x = -20 + ((time * 0.06) % 30); x < WIDTH; x += 30) {
    context.fillRect(x, GROUND_Y + 22, 12, 3);
  }

  if (options.drawBird !== false) {
    if (game.status === "ready") {
      game.bird.y = 268 + Math.sin(time * 0.003) * 7;
    }
    drawBird(context, game.bird, time);
  }

  if (options.drawOverlay !== false && game.status === "ready") {
    context.textAlign = "center";
    context.fillStyle = "#28483a";
    context.font = "700 30px 'Trebuchet MS', sans-serif";
    context.fillText("ready, bird?", WIDTH / 2, 205);
    context.fillStyle = "rgba(40,72,58,.72)";
    context.font = "500 12px 'Trebuchet MS', sans-serif";
    context.fillText("TAP OR PRESS SPACE TO TAKE OFF", WIDTH / 2, 231);
  } else if (options.drawOverlay !== false && game.status === "dead") {
    context.fillStyle = "rgba(37,54,44,.16)";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#fffaf0";
    roundedRect(context, (WIDTH - 300) / 2, 190, 300, 182, 18);
    context.fill();
    context.textAlign = "center";
    context.fillStyle = "#294b3b";
    context.font = "700 25px 'Trebuchet MS', sans-serif";
    context.fillText("Good try!", WIDTH / 2, 236);
    context.fillStyle = "#74877a";
    context.font = "500 12px 'Trebuchet MS', sans-serif";
    context.fillText("FLIGHT SCORE", WIDTH / 2, 267);
    context.fillStyle = "#294b3b";
    context.font = "700 41px 'Trebuchet MS', sans-serif";
    context.fillText(String(game.score), WIDTH / 2, 315);
    context.fillStyle = "#74877a";
    context.font = "500 11px 'Trebuchet MS', sans-serif";
    context.fillText(`BEST ${best}`, WIDTH / 2, 344);
  }

  if (options.drawScore !== false) {
    context.textAlign = "center";
    context.lineJoin = "round";
    context.font = "700 36px 'Trebuchet MS', sans-serif";
    context.lineWidth = 5;
    context.strokeStyle = "rgba(52,82,62,.22)";
    context.strokeText(String(game.score), WIDTH / 2, 61);
    context.fillStyle = "#fffdf2";
    context.fillText(String(game.score), WIDTH / 2, 61);
  }

  if (mode === "training" && options.drawBadge !== false) {
    context.textAlign = "left";
    context.fillStyle = "rgba(255,255,255,.86)";
    roundedRect(context, 14, 15, 105, 25, 13);
    context.fill();
    context.fillStyle = "#3e7857";
    context.beginPath();
    context.arc(27, 27.5, 3, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#42694f";
    context.font = "600 10px 'Trebuchet MS', sans-serif";
    context.fillText("AI PILOT", 36, 31);
  }
}

function drawSharedGroupScene(context, group, time, best) {
  const game = group.episodes.find((episode) => !episode.done)?.game ?? group.episodes[0].game;
  drawScene(context, game, "training", time, best, {
    drawBird: false,
    drawOverlay: false,
    drawScore: false,
    drawBadge: false,
  });
  const colors = ["#ffca62", "#81c4a4", "#f28d74", "#9aa7ea", "#d88cbb", "#b4cb79"];
  for (const [index, episode] of group.episodes.entries()) {
    if (episode.done) continue;
    context.save();
    drawBird(context, episode.game.bird, time + index * 83, colors[index % colors.length]);
    context.restore();
  }
  context.textAlign = "left";
  context.fillStyle = "rgba(255,255,255,.9)";
  roundedRect(context, 14, 15, 160, 25, 13);
  context.fill();
  context.fillStyle = "#477a55";
  context.beginPath();
  context.arc(27, 27.5, 3, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#42694f";
  context.font = "600 10px 'Trebuchet MS', sans-serif";
  context.fillText(`${group.episodes.length} SHARED POLICY · ADAPTIVE`, 36, 31);
}

function Stat({ label, value, suffix }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}<small>{suffix}</small></strong>
    </div>
  );
}

export default function App() {
  const canvasRef = useRef(null);
  const runtime = useRef(null);
  const [training, setTraining] = useState(false);
  const [trainingSpeed, setTrainingSpeed] = useState(1);
  const [groupSize, setGroupSize] = useState(24);
  const [learningRate, setLearningRate] = useState(0.03);
  const trainingConfig = useRef({ groupSize, learningRate, speed: trainingSpeed });
  trainingConfig.current = { groupSize, learningRate, speed: trainingSpeed };
  const [stats, setStats] = useState({
    score: 0,
    best: 0,
    round: 0,
    mean: 0,
    spread: 0,
    lastUpdate: "—",
    senses: { pipeDistance: 0, gapOffset: 0, gapTop: 0, gapBottom: 0, motion: "level" },
    flightY: [],
    rewardHistory: [],
  });

  if (!runtime.current) {
    const savedTraining = readTrainingState();
    const policy = savedTraining?.policy ?? createPolicy();
    runtime.current = {
      policy,
      game: createGame(1),
      mode: "idle",
      lastAction: 0,
      frame: 0,
      lastGroup: null,
      best: Number(localStorage.getItem("bird-best") || 0),
      trainingBest: Number(
        localStorage.getItem("bird-training-best-v16") ??
          localStorage.getItem("bird-training-best-v15") ??
          localStorage.getItem("bird-training-best-v14") ??
          0,
      ),
      round: savedTraining?.round ?? 0,
      time: 0,
      rewardHistory: savedTraining?.rewardHistory ?? [],
    };
  }

  const flap = useCallback(() => {
    const current = runtime.current;
    if (current.mode === "training") return;
    current.mode = "manual";
    if (current.game.status === "dead") {
      current.game = createGame(Date.now());
    }
    if (current.game.status === "ready") current.game.status = "playing";
    current.game.bird.vy = -7.3;
    current.game.flap = true;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    let animationFrame;
    let previous = performance.now();
    let accumulator = 0;
    const frameDuration = 1000 / 60;

    const render = (now) => {
      const current = runtime.current;
      accumulator += Math.min(60, now - previous);
      previous = now;
      while (accumulator >= frameDuration) {
        current.time += frameDuration;
        if (current.mode !== "training" && current.game.status === "playing") {
          let action = 0;
          if (current.mode === "manual") {
            action = current.game.flap ? 1 : 0;
          } else {
            action = policyAction(current.policy, getObservation(current.game));
          }
          current.game.flap = false;
          stepGame(current.game, action);
          if (current.game.status === "dead" && current.mode === "idle") {
            current.mode = "idle";
          }
        } else if (current.mode === "training" && current.group) {
          for (let step = 0; step < trainingConfig.current.speed; step += 1) {
            const groupComplete = stepRolloutGroup(
              current.group,
              current.policy,
              current.trainingBest,
            );
            const groupBestScore = Math.max(...current.group.episodes.map((episode) => episode.game.score));
            if (groupBestScore > current.trainingBest) {
              current.trainingBest = groupBestScore;
              localStorage.setItem("bird-training-best-v16", String(current.trainingBest));
            }
            if (groupBestScore > current.best) {
              current.best = groupBestScore;
              localStorage.setItem("bird-best", String(current.best));
            }
            if (!groupComplete) continue;

            current.round += 1;
            current.lastGroup = finishRolloutGroup(
              current.policy,
              current.group,
              trainingConfig.current.learningRate,
            );
            current.rewardHistory.push(current.lastGroup.mean);
            if (current.rewardHistory.length > 100) current.rewardHistory.shift();
            saveTrainingState(current);
            current.group = createRolloutGroup(
              trainingConfig.current.groupSize,
              current.round + 1,
            );
          }
        }
        current.frame += 1;
        accumulator -= frameDuration;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      if (current.mode === "training" && current.group) {
        drawSharedGroupScene(context, current.group, current.time, current.best);
      } else {
        drawScene(context, current.game, current.mode, current.time, current.best);
      }
      animationFrame = requestAnimationFrame(render);
    };

    animationFrame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    const updateStats = () => {
      const current = runtime.current;
      const sensedGame =
        current.group?.episodes.find((episode) => !episode.done)?.game ?? current.game;
      const observation = getObservation(sensedGame);
      const visibleScore =
        current.mode === "training" && current.group
          ? current.trainingBest
          : current.game.score;
      if (visibleScore > current.best) {
        current.best = visibleScore;
        localStorage.setItem("bird-best", String(current.best));
      }
      setStats((old) => ({
        ...old,
        score: visibleScore,
        best: current.best,
        round: current.round,
        mean: current.lastGroup?.mean ?? old.mean,
        spread: current.lastGroup?.spread ?? old.spread,
        lastUpdate: current.lastGroup?.flat ? "Flat group · skipped" : current.lastGroup ? "Policy updated" : "—",
        senses: {
          pipeDistance: Math.round(observation[2] * WIDTH),
          gapOffset: Math.round(observation[0] * HEIGHT),
          gapTop: Math.round(observation[3] * HEIGHT),
          gapBottom: Math.round(observation[4] * HEIGHT),
          motion:
            sensedGame.bird.vy < -0.2
              ? "rising"
              : sensedGame.bird.vy > 0.2
                ? "falling"
                : "level",
        },
        flightY: current.group ? current.group.episodes.filter((episode) => !episode.done).slice(0, 8).map((episode) => episode.game.bird.y) : [],
        rewardHistory: current.rewardHistory.slice(-30),
      }));
    };
    const interval = window.setInterval(updateStats, 200);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!training) return undefined;
    const current = runtime.current;
    current.mode = "training";
    current.group = createRolloutGroup(groupSize, current.round + 1);
    return () => {
      current.mode = "idle";
      current.group = null;
      current.game = createGame(Date.now());
    };
  }, [training, groupSize]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.code !== "Space" && event.code !== "ArrowUp") return;
      event.preventDefault();
      if (!event.repeat) flap();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flap]);

  const startTraining = () => {
    if (training) {
      setTraining(false);
      runtime.current.mode = "idle";
      return;
    }
    setTrainingSpeed(1);
    setTraining(true);
  };

  const startFastTraining = () => {
    setTrainingSpeed(10);
    setTraining(true);
  };

  const startManual = () => {
    setTraining(false);
    runtime.current.mode = "manual";
    runtime.current.game = createGame(Date.now());
    runtime.current.game.status = "playing";
    runtime.current.game.bird.vy = -7.3;
  };

  const reset = () => {
    setTraining(false);
    const current = runtime.current;
    const freshPolicy = createPolicy();
    current.policy = freshPolicy;
    current.mode = "idle";
    current.group = null;
    current.lastGroup = null;
    current.round = 0;
    current.trainingBest = 0;
    current.rewardHistory = [];
    current.game = createGame(Date.now());
    localStorage.removeItem(TRAINING_STORAGE_KEY);
    localStorage.removeItem("bird-training-v15");
    localStorage.removeItem("bird-training-v14");
    localStorage.removeItem("bird-training-best-v16");
    localStorage.removeItem("bird-training-best-v15");
    localStorage.removeItem("bird-training-best-v14");
    setStats((old) => ({
      ...old,
      score: 0,
      round: 0,
      mean: 0,
      spread: 0,
      lastUpdate: "—",
      rewardHistory: [],
    }));
  };

  const history = stats.rewardHistory;
  const historyMin = history.length ? Math.min(...history) : 0;
  const historyMax = history.length ? Math.max(...history) : 1;
  const historyRange = historyMax - historyMin || 1;
  const trendPoints = history
    .map((value, index) => {
      const x = history.length > 1 ? (index / (history.length - 1)) * 220 : 0;
      const y = 37 - ((value - historyMin) / historyRange) * 29;
      return `${x},${y}`;
    })
    .join(" ");
  const gapTarget =
    stats.senses.gapOffset > 5
      ? `${stats.senses.gapOffset}px above`
      : stats.senses.gapOffset < -5
        ? `${Math.abs(stats.senses.gapOffset)}px below`
        : "centered";
  const pipeDistance =
    stats.senses.pipeDistance > 0 ? `${stats.senses.pipeDistance}px` : "passing";

  return (
    <main className="app">
      <header className="topbar">
        <a className="wordmark" href="#" aria-label="Birdbrain home">
          <span className="wordmark-icon" aria-hidden="true">b</span>
          birdbrain<span className="wordmark-dot">.</span>
        </a>
        <div className="topbar-center"><span className="status-dot" /> REINFORCEMENT LEARNING LAB</div>
        <div className="topbar-right">EXPERIMENT <b>001</b><span className="topbar-divider" /> LOCAL SIM</div>
      </header>

      <section className="intro">
        <div>
          <div className="eyebrow"><span>THE POLICY PLAYGROUND</span><i /></div>
          <h1>One bird.<br /><span>A whole group.</span></h1>
          <p>Watch a little agent learn to fly by testing actions and learning from what happens.</p>
        </div>
        <div className="intro-note">
          <span className="note-icon">↗</span>
          <span>NO CRITIC. JUST<br /><b>BETTER FLIGHTS.</b></span>
        </div>
      </section>

      <section className="workspace">
        <div className="flight-column">
          <div className="flight-heading">
            <div className="flight-title"><span className="flight-indicator" /> LIVE FLIGHT <span className="flight-divider">/</span> <b>{training ? "AI TRAINING" : runtime.current.mode === "manual" ? "YOUR TURN" : "FREE PLAY"}</b></div>
            <div className="best-score">PERSONAL BEST <strong>{stats.best}</strong></div>
          </div>
          <div className="game-shell">
            <canvas
              ref={canvasRef}
              width={WIDTH}
              height={HEIGHT}
              className={`game-canvas${training ? " group-canvas" : ""}`}
              onPointerDown={flap}
              aria-label={training ? `${groupSize} birds training in one shared world` : "Flappy Bird game. Click or press space to flap."}
            />
            <div className="canvas-caption"><span>✦</span>{training ? `${groupSize} SHARED POLICY · ADAPTIVE` : <>FLAP TO FLY <kbd>SPACE</kbd></>}</div>
          </div>
          <div className="flight-footer">
            <div className="current-score"><span>{training ? "BEST TRAINING FLIGHT" : "THIS FLIGHT"}</span><strong>{String(stats.score).padStart(2, "0")}</strong></div>
            <div className="flight-actions">
              <button className={`button button-primary${training ? " is-training" : ""}`} onClick={startTraining}>
                <span>{training ? "Ⅱ" : "✳"}</span>{training ? "Pause training" : "Train the agent"}
              </button>
              <button
                className={`button button-secondary${training && trainingSpeed === 10 ? " is-fast-training" : ""}`}
                onClick={startFastTraining}
                aria-pressed={training && trainingSpeed === 10}
                title="Train ten times faster"
              >
                {training && trainingSpeed === 10 ? "10× training" : "Train 10×"}
              </button>
              <button className="button button-secondary" onClick={startManual}>✦ <span>Take the controls</span></button>
              <button className="icon-button" onClick={reset} aria-label="Restart game and reset learning" title="Restart game and reset learning">↻</button>
            </div>
          </div>
          <div className="keyboard-hint">TIP <span>Click the sky, tap the screen, or hit <kbd>SPACE</kbd> to flap.</span></div>
        </div>

        <aside className="learning-column">
          <section className="learning-card">
            <div className="card-overline">UNDER THE HOOD <span>01 — 03</span></div>
            <h2>Learning<br />by comparison.</h2>
            <p>Every bird greedily picks the action with the highest Q value plus a visit bonus. The bonus grows when a bird reaches 75% of the training high score, encouraging less-tried actions. Every flight updates the shared table.</p>
            <div className="vision-panel" aria-label="Live bird observations">
              <div className="vision-heading"><span>WHAT AN ACTIVE BIRD SEES</span><span>5 INPUTS</span></div>
              <div className="vision-grid">
                <div><small>PIPE</small><strong>{pipeDistance}</strong></div>
                <div><small>GAP CENTER</small><strong>{gapTarget}</strong></div>
                <div><small>OPENING</small><strong>{stats.senses.gapTop}–{stats.senses.gapBottom}px</strong></div>
                <div><small>MOTION</small><strong>{stats.senses.motion}</strong></div>
              </div>
            </div>
            <div className="group-preview" aria-label="Example group of sampled flights">
              {Array.from({ length: 8 }, (_, index) => {
                const birdY = stats.flightY[index];
                const height = birdY === undefined ? [0.32, 0.54, 0.83, 0.42, 0.68, 0.91, 0.48, 0.74][index] : 0.18 + (1 - birdY / GROUND_Y) * 0.72;
                return (
                <div className="flight-bar-wrap" key={index}>
                  <div className={`flight-bar${index === 5 ? " flight-bar-best" : ""}${birdY === undefined ? "" : " flight-bar-live"}`} style={{ height: `${Math.max(8, height * 58)}px` }} />
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
                );
              })}
            </div>
            <div className="group-caption"><span><i /> {stats.flightY.length ? "LIVE ALTITUDE" : "SAMPLE FLIGHTS"}</span><span>{stats.flightY.length ? "GREEDY POLICY" : "STAGGERED STARTS"}</span></div>
          </section>

          <section className="training-card">
            <div className="training-card-heading">
              <div><div className="card-overline">TRAINING LOOP <span>02 — 03</span></div><h3>Group setup</h3></div>
              <span className={`training-status${training ? " training-status-on" : ""}`}><i />{training ? "RUNNING" : "READY"}</span>
            </div>
            <label className="slider-label" htmlFor="group-size">
              <span>Flights per group <i>G</i></span><strong>{groupSize}</strong>
            </label>
            <input id="group-size" className="range-input" type="range" min="4" max="24" step="4" value={groupSize} onChange={(event) => setGroupSize(Number(event.target.value))} />
            <div className="range-scale"><span>4</span><span>24 parallel birds</span></div>
            <div className="slider-label beta-label"><span>Q update rate <i>α</i></span><strong>{learningRate.toFixed(3)}</strong></div>
            <input className="range-input beta-range" aria-label="Q-learning rate" type="range" min="0.005" max="0.15" step="0.005" value={learningRate} onChange={(event) => setLearningRate(Number(event.target.value))} />
            <div className="range-scale"><span>steady</span><span>faster updates</span></div>
            <div className="exploration-hint">All birds choose greedily using Q values plus an uncertainty bonus for less-tried actions. The bonus doubles after 75% of the training high score. Randomized starting positions separate their paths. Gaps narrow to normal over nine groups. Normal training is 1×; use Train 10× to speed it up.</div>
            <div className="mini-equation"><span>Q-LEARNING UPDATE</span><code>Q(s,a) ← Q(s,a) + α[r + γ maxₐ′Q(s′,a′) − Q(s,a)]</code></div>
          </section>

          <section className="stats-card">
            <div className="card-overline">LATEST UPDATE <span>03 — 03</span></div>
            <div className="stats-row">
              <Stat label="TRAINING ROUNDS" value={stats.round} suffix="" />
              <Stat label="GROUP MEAN" value={stats.round ? stats.mean.toFixed(1) : "—"} suffix={stats.round ? " pts" : ""} />
              <Stat label="REWARD SPREAD" value={stats.round ? stats.spread.toFixed(1) : "—"} suffix="" />
            </div>
            <div className="trend-block">
              <div className="trend-heading"><span>GROUP RETURN TREND</span><span>{history.length ? `${history.length} GROUPS` : "WAITING FOR UPDATES"}</span></div>
              <svg className="trend-chart" viewBox="0 0 220 42" role="img" aria-label="Recent group return trend; higher rewards are better">
                <line x1="0" x2="220" y1="37" y2="37" className="trend-baseline" />
                {history.length > 1 && <polyline points={trendPoints} className="trend-line" />}
              </svg>
              <div className="trend-caption">Higher group returns mean better flights.</div>
            </div>
            <div className="update-note"><span className={stats.lastUpdate.includes("skipped") ? "update-dot muted" : "update-dot"} />{stats.lastUpdate}</div>
          </section>

          <div className="reward-note"><span>✳</span><p><b>Training rewards:</b> +1 per frame alive, +50 per pipe, −10 on collision, plus gap-alignment feedback.</p></div>
        </aside>
      </section>

      <footer className="page-footer"><span>BIRDBRAIN <i /> A TINY POLICY, LEARNING TO FLY</span><span>MADE FOR CURIOUS MINDS <b>↗</b></span></footer>
    </main>
  );
}
