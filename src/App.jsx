import { useState, useEffect, useRef } from "react"
import { io } from "socket.io-client"

const socket = io("https://music-quiz-production-b8f9.up.railway.app")
const LASTFM_KEY = "5ae7aaa16891fc49403d389293103d97"

const C = {
  teal: "#1D9E75",
  tealLight: "#E1F5EE",
  tealDark: "#0F6E56",
  red: "#E24B4A",
  redLight: "#FCEBEB",
  redDark: "#A32D2D",
  amber: "#EF9F27",
}

const s = {
  page: { padding: "24px 20px", maxWidth: "480px", margin: "0 auto" },
  title: { fontSize: "22px", fontWeight: "500", color: "var(--color-text-primary)", marginBottom: "4px" },
  subtitle: { fontSize: "14px", color: "var(--color-text-secondary)", marginBottom: "20px" },
  input: { display: "block", width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)", fontSize: "15px", marginBottom: "10px", outline: "none", boxSizing: "border-box" },
  btnPrimary: { display: "block", width: "100%", padding: "12px", borderRadius: "10px", border: "1px solid #1D9E75", fontSize: "15px", fontWeight: "500", cursor: "pointer", background: "#1D9E75", color: "white", marginBottom: "8px" },
  btnSecondary: { display: "block", width: "100%", padding: "12px", borderRadius: "10px", border: "1px solid var(--color-border-secondary)", fontSize: "15px", fontWeight: "500", cursor: "pointer", background: "var(--color-background-primary)", color: "var(--color-text-primary)", marginBottom: "8px" },
  btnDisabled: { display: "block", width: "100%", padding: "12px", borderRadius: "10px", border: "1px solid var(--color-border-secondary)", fontSize: "15px", fontWeight: "500", cursor: "not-allowed", background: "var(--color-background-secondary)", color: "var(--color-text-tertiary)", marginBottom: "8px", opacity: 0.5 },
  card: { background: "var(--color-background-primary)", border: "1px solid var(--color-border-secondary)", borderRadius: "12px", padding: "16px", marginBottom: "16px" },
  playerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px #848483ff", fontSize: "14px" },
  tag: { fontSize: "12px", background: "#E1F5EE", color: "#0F6E56", borderRadius: "20px", padding: "3px 10px" },
  codeBox: { background: "var(--color-background-secondary)", border: "1px solid var(--color-border-secondary)", borderRadius: "8px", padding: "8px 16px", fontSize: "26px", fontWeight: "500", letterSpacing: "0.15em", color: "var(--color-text-primary)", display: "inline-block", marginBottom: "16px" },
  muted: { fontSize: "13px", color: "var(--color-text-tertiary)" },
  scoreRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--color-background-secondary)", border: "1px solid var(--color-border-secondary)", borderRadius: "8px", marginBottom: "6px", fontSize: "14px" },
  answerBtn: { display: "block", width: "100%", padding: "12px 14px", borderRadius: "10px", marginBottom: "8px", fontSize: "14px", textAlign: "left", cursor: "pointer", border: "1px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" },
}

function playSound(type) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const oscillator = ctx.createOscillator()
  const gainNode = ctx.createGain()
  oscillator.connect(gainNode)
  gainNode.connect(ctx.destination)
  if (type === "correct") {
    oscillator.frequency.setValueAtTime(523, ctx.currentTime)
    oscillator.frequency.setValueAtTime(659, ctx.currentTime + 0.1)
    oscillator.frequency.setValueAtTime(784, ctx.currentTime + 0.2)
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + 0.5)
  } else if (type === "wrong") {
    oscillator.frequency.setValueAtTime(300, ctx.currentTime)
    oscillator.frequency.setValueAtTime(200, ctx.currentTime + 0.1)
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + 0.4)
  }
}

async function getTopTracks(tag) {
  const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=tag.gettoptracks&tag=${encodeURIComponent(tag)}&api_key=${LASTFM_KEY}&format=json&limit=200`)
  const data = await res.json()
  return data.tracks.track.map(t => ({ name: t.name, artist: t.artist.name }))
}

export default function App() {
  const [screen, setScreen] = useState("home")
  const [playerName, setPlayerName] = useState("")
  const [roomCode, setRoomCode] = useState("")
  const [room, setRoom] = useState(null)
  const [guessMode, setGuessMode] = useState("both")
  const [genre, setGenre] = useState("")
  const [confirmedGenre, setConfirmedGenre] = useState(false)
  const [loadingGenre, setLoadingGenre] = useState(false)
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  const spinnerFrames = ["⠋", "⠙", "⠸", "⠴", "⠦", "⠇"]
  const [error, setError] = useState("")
  const [question, setQuestion] = useState(null)
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [reveal, setReveal] = useState(null)
  const [scores, setScores] = useState(null)
  const [results, setResults] = useState(null)
  const [timeLeft, setTimeLeft] = useState(30)
  const [answeredCount, setAnsweredCount] = useState(0)
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [allTimeScores, setAllTimeScores] = useState({})
  const timerRef = useRef(null)
  const audioRef = useRef(null)

  function showError(msg) {
    setError(msg)
    setTimeout(() => setError(""), 3000)
  }

  useEffect(() => {
    socket.on("room_created", ({ code, players }) => { setRoom({ code, players }); setScreen("lobby") })
    socket.on("room_joined", ({ code, players }) => { setRoom({ code, players }); setScreen("lobby") })
    socket.on("guess_mode_updated", ({ guessMode }) => { setGuessMode(guessMode) })
    socket.on("room_updated", ({ players }) => { setRoom(prev => ({ ...prev, players })) })
    socket.on("game_starting", ({ guessMode }) => { setGuessMode(guessMode); setScreen("game") })
    socket.on("new_question", (data) => {
      setQuestion(data); setSelectedAnswer(null); setReveal(null)
      setResults(null); setTimeLeft(30); setAnsweredCount(0)
      if (data.previewUrl && audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = data.previewUrl
        audioRef.current.load()
        audioRef.current.play().catch(e => console.log("play failed:", e))
      }
    })
    socket.on("answer_count", ({ count }) => { setAnsweredCount(count) })
    socket.on("reveal_answer", ({ correct, scores, players, results }) => {
      setReveal(correct); setScores({ scores, players }); setResults(results)
      if (timerRef.current) clearInterval(timerRef.current)
      if (audioRef.current) audioRef.current.pause()
    })
    socket.on("game_over", ({ scores, players }) => {
      setScores({ scores, players })
      setAllTimeScores(prev => {
        const updated = { ...prev }
        players.forEach(p => { updated[p.name] = (updated[p.name] || 0) + (scores[p.id] || 0) })
        return updated
      })
      setScreen("gameover")
    })
    socket.on("rematch_starting", () => {
      setScreen("lobby"); setQuestion(null); setSelectedAnswer(null)
      setReveal(null); setResults(null); setScores(null)
      setConfirmedGenre(false); setGenre(""); setAudioUnlocked(false)
      setTimeLeft(30); setAnsweredCount(0)
    })
    socket.on("error", ({ message }) => { showError(message) })
    return () => {
      socket.off("room_created"); socket.off("room_joined"); socket.off("room_updated")
      socket.off("guess_mode_updated"); socket.off("game_starting"); socket.off("new_question")
      socket.off("answer_count"); socket.off("reveal_answer"); socket.off("game_over")
      socket.off("rematch_starting"); socket.off("error")
    }
  }, [])

  useEffect(() => {
    if (!question || reveal) return
    if (timerRef.current) clearInterval(timerRef.current)
    setTimeLeft(30)
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [question])

  useEffect(() => {
    if (!loadingGenre) return
    const interval = setInterval(() => { setSpinnerFrame(prev => (prev + 1) % 6) }, 100)
    return () => clearInterval(interval)
  }, [loadingGenre])

  if (screen === "home") return (
    <div style={s.page}>
      <div style={{ fontSize: "36px", marginBottom: "8px" }}>🎵</div>
      <div style={s.title}>Music Quiz</div>
      <div style={s.subtitle}>Play with friends, guess the song</div>
      <input
        style={s.input}
        value={playerName}
        onChange={e => setPlayerName(e.target.value)}
        placeholder="Your name"
      />
      <button style={s.btnPrimary} onClick={() => {
        if (!playerName.trim()) return showError("Enter your name first!")
        socket.emit("create_room", { playerName })
      }}>Create room</button>
      <button style={s.btnSecondary} onClick={() => {
        if (!playerName.trim()) return showError("Enter your name first!")
        setScreen("join")
      }}>Join room</button>
      {error && <p style={{ color: C.red, fontSize: "13px", marginTop: "4px" }}>{error}</p>}
      <p style={{ marginTop: "32px", fontSize: "12px", color: "var(--color-text-tertiary)", lineHeight: "1.8" }}>
        🎵 no ads, ever, but you can<br />
        <a href="https://ko-fi.com/chromakala" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-text-tertiary)", textDecoration: "underline" }}>buy me a coffee ☕</a>
      </p>
    </div>
  )

  if (screen === "join") return (
    <div style={s.page}>
      <div style={s.title}>Join a room</div>
      <div style={s.subtitle}>Enter the room code from your friend</div>
      <input
        style={s.input}
        value={roomCode}
        onChange={e => setRoomCode(e.target.value.toLowerCase())}
        placeholder="Room code"
      />
      <button style={s.btnPrimary} onClick={() => {
        if (!roomCode.trim()) return showError("Enter a room code!")
        socket.emit("join_room", { code: roomCode, playerName })
      }}>Join</button>
      <button style={s.btnSecondary} onClick={() => setScreen("home")}>Back</button>
      {error && <p style={{ color: C.red, fontSize: "13px", marginTop: "4px" }}>{error}</p>}
    </div>
  )

  if (screen === "lobby") return (
    <div style={s.page}>
      <div style={s.title}>Lobby</div>
      <div style={{ marginBottom: "16px" }}>
        <div style={{ ...s.muted, marginBottom: "6px" }}>Room code</div>
        <div style={s.codeBox}>{room.code}</div>
      </div>

      {!audioUnlocked ? (
        <button style={{ ...s.btnPrimary, marginBottom: "16px", background: "#7F77DD", border: "1px solid #7F77DD" }} onClick={() => {
          const audio = new Audio()
          audio.volume = 1
          audioRef.current = audio
          audio.play().catch(() => {})
          setAudioUnlocked(true)
        }}>🎵 Tap to enable music</button>
      ) : (
        <p style={{ color: C.teal, fontSize: "13px", marginBottom: "12px" }}>✅ Music enabled!</p>
      )}

      <div style={s.card}>
        <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text-secondary)", marginBottom: "8px" }}>Players ({room.players.length}/6)</div>
        {room.players.map((p, i) => (
          <div key={i} style={{ ...s.playerRow, borderBottom: i === room.players.length - 1 ? "none" : "1px solid var(--color-border-secondary)" }}>
            <span>{p.name}</span>
            {p.genre
              ? <span style={s.tag}>{p.genre} ✓</span>
              : <span style={s.muted}>picking...</span>
            }
          </div>
        ))}
      </div>

      {!confirmedGenre && (
        <div style={s.card}>
          <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text-secondary)", marginBottom: "8px" }}>Pick a genre or artist</div>
          <input
            style={s.input}
            value={genre}
            onChange={e => setGenre(e.target.value)}
            placeholder="e.g. pop, rock, taylor swift"
          />
          <button
            style={{ ...s.btnPrimary, opacity: loadingGenre ? 0.6 : 1, cursor: loadingGenre ? "not-allowed" : "pointer" }}
            disabled={loadingGenre}
            onClick={async () => {
              if (!genre.trim()) return showError("Enter a genre or artist!")
              setError("")
              setLoadingGenre(true)
              const tracks = await getTopTracks(genre)
              setLoadingGenre(false)
              if (!tracks || tracks.length < 4) return showError("Couldn't find enough tracks! Try a different genre.")
              socket.emit("select_genre", { code: room.code, genre, tracks })
              setConfirmedGenre(true)
            }}
          >
            {loadingGenre ? `${spinnerFrames[spinnerFrame]} Loading tracks...` : "Confirm"}
          </button>
        </div>
      )}
      {confirmedGenre && <p style={{ color: C.teal, fontSize: "13px", marginBottom: "16px" }}>✅ Genre confirmed: {genre}</p>}

      {room.players.every(p => p.genre) && (
        <div style={s.card}>
          <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text-secondary)", marginBottom: "10px" }}>What to guess?</div>
          {room.players[0].id === socket.id ? (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
              {[["both", "🎵 Song + Artist"], ["song", "🎵 Song only"], ["artist", "🎤 Artist only"]].map(([mode, label]) => (
                <button key={mode}
                  onClick={() => { setGuessMode(mode); socket.emit("set_guess_mode", { code: room.code, guessMode: mode }) }}
                  style={{ padding: "8px 14px", borderRadius: "8px", fontSize: "13px", cursor: "pointer", border: `1px solid ${guessMode === mode ? C.teal : "var(--color-border-secondary)"}`, background: guessMode === mode ? C.tealLight : "var(--color-background-primary)", color: guessMode === mode ? C.tealDark : "var(--color-text-primary)" }}>
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p style={s.muted}>Mode: <strong>{guessMode === "both" ? "Song + Artist" : guessMode === "song" ? "Song only" : "Artist only"}</strong> (set by host)</p>
          )}
        </div>
      )}

      {room.players[0].id === socket.id && (
        room.players.every(p => p.genre)
          ? <button style={s.btnPrimary} onClick={() => { setError(""); socket.emit("start_game", { code: room.code, guessMode }) }}>Start game</button>
          : <button style={s.btnDisabled} disabled>Waiting for all players...</button>
      )}
      {error && <p style={{ color: C.red, fontSize: "13px", marginTop: "4px" }}>{error}</p>}
    </div>
  )

  if (screen === "game") return (
    <div style={s.page}>
      {!question && (
        <div style={{ textAlign: "center", paddingTop: "60px" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>🎵</div>
          <div style={s.title}>Get ready...</div>
        </div>
      )}
      {question && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <div style={s.muted}>Question {question.questionNumber} of {question.total}</div>
            <div style={{ fontSize: "20px", fontWeight: "500", color: timeLeft <= 5 ? C.red : timeLeft <= 10 ? C.amber : C.teal }}>{timeLeft}s</div>
          </div>
          <div style={{ height: "6px", background: "var(--color-background-secondary)", borderRadius: "4px", margin: "8px 0 12px", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(timeLeft / 30) * 100}%`, background: timeLeft <= 5 ? C.red : timeLeft <= 10 ? C.amber : C.teal, borderRadius: "4px", transition: "width 1s linear" }} />
          </div>
          <div style={{ ...s.muted, marginBottom: "14px" }}>
            🎵 {question.previewUrl ? "Now playing" : "No preview"} · {answeredCount}/{room.players.length} answered
          </div>
          <div style={{ marginBottom: "16px" }}>
            {question.options.map((opt, i) => {
              const isSelected = selectedAnswer === opt.name
              const isCorrect = reveal && opt.name === reveal.name
              const isWrong = reveal && isSelected && !isCorrect
              return (
                <button key={i} disabled={!!selectedAnswer}
                  onClick={() => {
                    setSelectedAnswer(opt.name)
                    socket.emit("submit_answer", { code: room.code, answer: opt.name })
                    if (question.correct && opt.name === question.correct.name) playSound("correct")
                    else playSound("wrong")
                  }}
                  style={{
                    ...s.answerBtn,
                    border: `1px solid ${isCorrect ? C.teal : isWrong ? C.red : "var(--color-border-secondary)"}`,
                    background: isCorrect ? C.tealLight : isWrong ? C.redLight : isSelected ? "var(--color-background-secondary)" : "var(--color-background-primary)",
                    color: isCorrect ? C.tealDark : isWrong ? C.redDark : "var(--color-text-primary)",
                    cursor: selectedAnswer ? "default" : "pointer"
                  }}>
                  {opt.display || `${opt.name} — ${opt.artist}`}
                </button>
              )
            })}
          </div>
          {reveal && (
            <div style={{ padding: "12px 14px", background: C.tealLight, border: `1px solid ${C.teal}`, borderRadius: "10px", marginBottom: "16px" }}>
              <div style={{ fontSize: "13px", color: C.tealDark }}>✅ Correct: <strong>{reveal.name}</strong> by {reveal.artist}</div>
            </div>
          )}
          <div style={s.card}>
            <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text-secondary)", marginBottom: "8px" }}>Scoreboard</div>
            {(scores ? scores.players.map(p => ({ ...p, score: scores.scores[p.id] || 0 })) : room.players.map(p => ({ ...p, score: 0 })))
              .sort((a, b) => b.score - a.score)
              .map((p, i) => (
                <div key={i} style={s.scoreRow}>
                  <span>{results && results[p.id] ? results[p.id].correct ? "✅ " : results[p.id].answered ? "❌ " : "⏱️ " : ""}{i + 1}. {p.name}</span>
                  <strong>{p.score} pts</strong>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )

  if (screen === "gameover") {
    const sortedPlayers = scores.players.map(p => ({ ...p, score: scores.scores[p.id] || 0 })).sort((a, b) => b.score - a.score)
    const sortedAllTime = Object.entries(allTimeScores).sort((a, b) => b[1] - a[1])
    return (
      <div style={s.page}>
        <div style={{ fontSize: "40px", marginBottom: "8px" }}>🏆</div>
        <div style={s.title}>Game over!</div>
        <div style={{ ...s.card, marginTop: "16px" }}>
          {sortedPlayers.map((p, i) => (
            <div key={i} style={{ ...s.playerRow, borderBottom: i === sortedPlayers.length - 1 ? "none" : "1px solid var(--color-border-secondary)" }}>
              <span>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`} {p.name}</span>
              <strong>{p.score} pts</strong>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          {room.players[0].id === socket.id
            ? <button style={{ ...s.btnPrimary, flex: 1, marginBottom: 0 }} onClick={() => socket.emit("rematch", { code: room.code })}>🔄 Rematch</button>
            : <div style={{ ...s.btnDisabled, flex: 1, textAlign: "center" }}>⏳ Waiting for host...</div>
          }
          <button style={{ ...s.btnSecondary, flex: 1, marginBottom: 0 }} onClick={() => window.location.reload()}>Leave</button>
        </div>
        <div style={{ marginBottom: "24px" }}>
          <a href="https://ko-fi.com/chromakala" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-block", padding: "10px 20px", background: "#4caf50", color: "white", borderRadius: "8px", textDecoration: "none", fontSize: "14px", fontWeight: "500" }}>
            Support a late night coder ☕
          </a>
        </div>
        {sortedAllTime.length > 0 && (
          <div>
            <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text-secondary)", marginBottom: "10px" }}>📊 All-time this session</div>
            <div style={s.card}>
              {sortedAllTime.map(([name, score], i) => (
                <div key={i} style={{ ...s.playerRow, borderBottom: i === sortedAllTime.length - 1 ? "none" : "1px solid var(--color-border-secondary)" }}>
                  <span style={{ fontSize: "14px" }}>{i + 1}. {name}</span>
                  <strong>{score} pts</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }
}