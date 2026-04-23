import { useState, useEffect, useRef } from "react"
import { io } from "socket.io-client"

const socket = io("https://music-quiz-production-b8f9.up.railway.app", {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
})
const LASTFM_KEY = "5ae7aaa16891fc49403d389293103d97"

async function getTopTracks(tag) {
  const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=tag.gettoptracks&tag=${encodeURIComponent(tag)}&api_key=${LASTFM_KEY}&format=json&limit=200`)
  const data = await res.json()
  return data.tracks.track.map(t => ({ name: t.name, artist: t.artist.name }))
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

export default function App() {
  const [playerCount, setPlayerCount] = useState(0)
  const [screen, setScreen] = useState("home")
  const [playerName, setPlayerName] = useState("")
  const [roomCode, setRoomCode] = useState("")
  const [room, setRoom] = useState(null)
  const [guessMode, setGuessMode] = useState("both")
  const [genre, setGenre] = useState("")
  const [confirmedGenre, setConfirmedGenre] = useState(false)
  const [loadingGenre, setLoadingGenre] = useState(false)
  const [lastAnswered, setLastAnswered] = useState("")
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  const [questionCount, setQuestionCount] = useState(15)
  const spinnerFrames = ["⠋", "⠙", "⠸", "⠴", "⠦", "⠇"]
  const [error, setError] = useState("")
  function showError(msg) {
    setError(msg)
    setTimeout(() => setError(""), 3000)
  }
  const [question, setQuestion] = useState(null)
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [reveal, setReveal] = useState(null)
  const [scores, setScores] = useState(null)
  const [results, setResults] = useState(null)
  const [timeLeft, setTimeLeft] = useState(30)
  const [answeredCount, setAnsweredCount] = useState(0)
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [allTimeScores, setAllTimeScores] = useState({})
  const [lyricsInput, setLyricsInput] = useState("")
  const [audioReadyCount, setAudioReadyCount] = useState(0)
  const roomCodeRef = useRef(localStorage.getItem("roomCode") || null)
  const playerNameRef = useRef(localStorage.getItem("playerName") || null)
  const timerRef = useRef(null)
  const audioRef = useRef(null)

  function sendEmoji(emoji) {
    socket.emit("send_emoji", { code: room.code, playerName: playerNameRef.current, emoji })
  }

  useEffect(() => {
    socket.on("player_count", ({ count }) => { setPlayerCount(count) })

    socket.on("connect", () => {
      if (roomCodeRef.current && playerNameRef.current) {
        socket.emit("rejoin_room", { code: roomCodeRef.current, playerName: playerNameRef.current })
      }
    })

    socket.on("room_created", ({ code, players }) => {
      setRoom({ code, players })
      roomCodeRef.current = code
      localStorage.setItem("roomCode", code)
      setScreen("lobby")
    })

    socket.on("room_joined", ({ code, players }) => {
      setRoom({ code, players })
      roomCodeRef.current = code
      localStorage.setItem("roomCode", code)
      setScreen(prev => prev === "game" || prev === "gameover" ? prev : "lobby")
    })
    socket.on("audio_ready_update", ({ count, total }) => {
      setAudioReadyCount(count)
    })
    socket.on("guess_mode_updated", ({ guessMode }) => { setGuessMode(guessMode) })
    socket.on("room_updated", ({ players }) => { setRoom(prev => ({ ...prev, players })) })
    socket.on("game_starting", ({ guessMode }) => { setGuessMode(guessMode); setScreen("game"); window.scrollTo(0, 0) })

    socket.on("new_question", (data) => {
      setQuestion(data); setSelectedAnswer(null); setReveal(null)
      setResults(null); setTimeLeft(30); setAnsweredCount(0); setLyricsInput(""); window.scrollTo(0, 0)
      if (data.previewUrl && audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = data.previewUrl
        audioRef.current.load()
        audioRef.current.volume = data.mode === "lyrics" ? 0.2 : 1
        audioRef.current.play().catch(e => console.log("play failed:", e))
      }
    })

    socket.on("answer_count", ({ count, playerName }) => {
      setAnsweredCount(count)
      if (playerName) {
        setLastAnswered(playerName)
        setTimeout(() => setLastAnswered(""), 2000)
      }
    })
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
      setTimeLeft(30); setAnsweredCount(0); setAudioReadyCount(0)
    })

    socket.on("emoji_reaction", ({ playerName, emoji }) => {
      const el = document.createElement("div")
      el.style.cssText = `
        position: fixed;
        left: ${Math.random() * 60 + 20}%;
        bottom: 20%;
        font-size: 36px;
        animation-name: floatUp;
        animation-duration: 1.5s;
        animation-timing-function: ease-out;
        animation-fill-mode: forwards;
        animation-iteration-count: 1;
        pointer-events: none;
        z-index: 999;
        text-align: center;
      `
      el.innerHTML = `${emoji}<div style="font-size:10px;color:#666;background:white;border-radius:8px;padding:1px 4px">${playerName}</div>`
      document.body.appendChild(el)
      setTimeout(() => el.remove(), 2500)
    })

    socket.on("error", ({ message }) => { showError(message) })

    return () => {
      socket.off("room_created"); socket.off("room_joined"); socket.off("room_updated")
      socket.off("guess_mode_updated"); socket.off("game_starting"); socket.off("new_question")
      socket.off("answer_count"); socket.off("reveal_answer"); socket.off("game_over")
      socket.off("rematch_starting"); socket.off("error"); socket.off("connect")
      socket.off("player_count"); socket.off("emoji_reaction"); socket.off("audio_ready_update")
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

  const CountdownMessage = () => {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const steps = [
    { number: "3", text: "Warming up the speakers..." },
    { number: "2", text: "Bribing the DJ..." },
    { number: "1", text: "Party time!" },
    { number: "", text: "Still fetching some data..." }
  ]

  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 100)
    const hide = step < 3 ? setTimeout(() => setVisible(false), 800) : null
    const next = step < 3 ? setTimeout(() => {
      setVisible(false)
      setTimeout(() => {
        setStep(s => s + 1)
        setVisible(true)
      }, 300)
    }, 800) : null
    return () => { clearTimeout(show); if (hide) clearTimeout(hide); if (next) clearTimeout(next) }
  }, [step])

  return (
    <div style={{ marginTop: "40px", minHeight: "60px", textAlign: "center" }}>
      <div style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 0.3s ease",
      }}>
        <div style={{ fontSize: "28px", fontWeight: "600", color: "#1D9E75", marginBottom: "8px" }}>
          {steps[step].number}
        </div>
        <div style={{ fontSize: "14px", color: "#999" }}>
          {steps[step].text}
        </div>
      </div>
    </div>
  )
}
  const EmojiButtons = () => (
    <div style={{ display: "flex", justifyContent: "center", gap: "16px", marginTop: "0px", marginBottom: "0px" }}>
      {["💩", "😎", "🤣", "🤬"].map(emoji => (
        <button key={emoji} onClick={() => sendEmoji(emoji)} style={{ fontSize: "28px", background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
          {emoji}
        </button>
      ))}
    </div>
  )

  // HOME SCREEN
  if (screen === "home") {
    return (
      <div style={{ padding: "80px 20px 24px", maxWidth: "400px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ fontSize: "35px", marginBottom: "8px" }}>🎵🎶</div>
          <h1 style={{ margin: 0, fontSize: "26px" }}>Music Quiz</h1>
        </div>
        <input
          value={playerName}
          onChange={e => setPlayerName(e.target.value)}
          placeholder="Enter your name"
          maxLength={7}
          style={{ display: "block", width: "100%", padding: "10px 12px", fontSize: "15px", border: "1px solid #ccc", borderRadius: "8px", marginBottom: "16px", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
          <button
            style={{ width: "200px", padding: "12px", fontSize: "15px", background: "#1D9E75", color: "white", border: "none", borderRadius: "10px", cursor: "pointer" }}
            onClick={() => {
              if (!playerName.trim()) return showError("Enter your name first!")
              playerNameRef.current = playerName
              localStorage.setItem("playerName", playerName)
              socket.emit("create_room", { playerName })
            }}
          >
            Create Room
          </button>
          <button
            style={{ width: "200px", padding: "12px", fontSize: "15px", background: "white", color: "#333", border: "1px solid #ccc", borderRadius: "10px", cursor: "pointer" }}
            onClick={() => {
              if (!playerName.trim()) return showError("Enter your name first!")
              playerNameRef.current = playerName
              localStorage.setItem("playerName", playerName)
              setScreen("join")
            }}
          >
            Join Room
          </button>
        </div>
        {error && <p style={{ color: "red", fontSize: "13px", marginTop: "8px", textAlign: "center" }}>{error}</p>}
        <p style={{ marginTop: "40px", fontSize: "12px", color: "#999", lineHeight: "1.8", textAlign: "center" }}>
          🎵 no ads, ever, but you can<br />
          <a href="https://ko-fi.com/chromakala" target="_blank" rel="noopener noreferrer" style={{ color: "#999", textDecoration: "underline" }}>buy me a coffee ☕</a>
        </p>
        {playerCount > 0 && (
          <p style={{ marginTop: "16px", fontSize: "12px", color: "#999", textAlign: "center" }}>
            🟢 {playerCount} {playerCount === 1 ? "person" : "people"} currently playing
          </p>
        )}
      </div>
    )
  }

  // JOIN SCREEN
  if (screen === "join") {
    return (
      <div style={{ padding: "80px 20px 24px", maxWidth: "400px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "26px", marginBottom: "4px" }}>Join a Room</h1>
        <p style={{ color: "#666", fontSize: "14px", marginBottom: "20px" }}>Enter the room code from your friend</p>
        <input
          value={roomCode}
          onChange={e => setRoomCode(e.target.value.toLowerCase())}
          placeholder="Room code"
          style={{ display: "block", width: "100%", padding: "10px 12px", fontSize: "15px", border: "1px solid #ccc", borderRadius: "8px", marginBottom: "10px", boxSizing: "border-box" }}
        />
        <button
          style={{ display: "block", width: "100%", padding: "12px", fontSize: "15px", background: "#1D9E75", color: "white", border: "none", borderRadius: "10px", cursor: "pointer", marginBottom: "8px" }}
          onClick={() => {
            if (!roomCode.trim()) return showError("Enter a room code!")
            playerNameRef.current = playerName
            localStorage.setItem("playerName", playerName)
            socket.emit("join_room", { code: roomCode, playerName })
          }}
        >
          Join
        </button>
        <button
          style={{ display: "block", width: "100%", padding: "12px", fontSize: "15px", background: "white", color: "#333", border: "1px solid #ccc", borderRadius: "10px", cursor: "pointer" }}
          onClick={() => setScreen("home")}
        >
          Back
        </button>
        {error && <p style={{ color: "red", fontSize: "13px", marginTop: "8px" }}>{error}</p>}
      </div>
    )
  }

  // LOBBY SCREEN
  if (screen === "lobby") {
    const allAudioReady = audioReadyCount >= room.players.length
    return (
      <div style={{ padding: "20px 24px", width: "400px", maxWidth: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h1 style={{ fontSize: "26px", margin: 0 }}>Lobby</h1>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: "12px", color: "#999", margin: 0 }}>Room code</p>
            <div style={{ fontSize: "20px", fontWeight: "600", letterSpacing: "0.15em" }}>{room.code}</div>
            <button onClick={() => {
              localStorage.removeItem("roomCode")
              localStorage.removeItem("playerName")
              roomCodeRef.current = null
              playerNameRef.current = null
              window.location.reload()
            }} style={{ fontSize: "12px", color: "#999", background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: "4px" }}>Leave</button>
          </div>
        </div>

        {!audioUnlocked ? (
          <button
            style={{ display: "block", width: "100%", padding: "12px", fontSize: "15px", background: "#5cd8f1ff", color: "white", border: "none", borderRadius: "10px", cursor: "pointer", marginBottom: "16px", animation: "pulse 1.5s ease-in-out infinite" }}
            onClick={() => {
              const audio = new Audio()
              audio.volume = 1
              audioRef.current = audio
              audio.play().catch(() => {})
              setAudioUnlocked(true)
              socket.emit("audio_ready", { code: room.code })
            }}
          >
            🎵 Tap to enable music 🎵
          </button>
        ) : (
          <p style={{ color: "#1D9E75", fontSize: "13px", marginBottom: "12px" }}>✅ Music enabled!</p>
        )}

        <p style={{ fontSize: "13px", color: "#999", marginBottom: "8px" }}>Players ({room.players.length}/6)</p>
        <div style={{ marginBottom: "16px" }}>
          {room.players.map((p, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #eee" }}>
              <span style={{ fontSize: "15px" }}>{p.name}</span>
              {p.genre
                ? <span style={{ fontSize: "12px", background: "#E1F5EE", color: "#0F6E56", borderRadius: "20px", padding: "3px 10px" }}>{p.genre} ✓</span>
                : <span style={{ fontSize: "13px", color: "#999" }}>picking...</span>
              }
            </div>
          ))}
        </div>

        {!confirmedGenre && (
          <div style={{ marginBottom: "16px", minHeight: "130px" }}>
            <p style={{ fontSize: "13px", color: "#999", marginBottom: "8px" }}>Pick a genre or artist</p>
            <input
              value={genre}
              onChange={e => setGenre(e.target.value)}
              placeholder="..80s, ABBA, pop, rock.."
              style={{ display: "block", width: "100%", padding: "10px 12px", fontSize: "15px", border: "1px solid #ccc", borderRadius: "8px", marginBottom: "10px", boxSizing: "border-box" }}
            />
            <button
              disabled={loadingGenre}
              style={{ display: "block", width: "100%", padding: "12px", fontSize: "15px", background: "#1D9E75", color: "white", border: "none", borderRadius: "10px", cursor: loadingGenre ? "not-allowed" : "pointer", opacity: loadingGenre ? 0.6 : 1 }}
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
        {confirmedGenre && <p style={{ color: "#1D9E75", fontSize: "13px", marginBottom: "16px", minHeight: "130px" }}>✅ Genre confirmed: {genre}</p>}

        <div style={{ marginBottom: "16px" }}>
          <p style={{ fontSize: "13px", color: "#999", marginBottom: "8px" }}>What to guess?</p>
          {room.players[0].id === socket.id ? (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
              {[["both", "🎵 Song + Artist"], ["song", "🎵 Song only"], ["artist", "🎤 Artist only"], ["lyrics", "📝 Fill in lyrics"]].map(([mode, label]) => (
                <button key={mode}
                  onClick={() => { setGuessMode(mode); socket.emit("set_guess_mode", { code: room.code, guessMode: mode }) }}
                  style={{ padding: "8px 14px", borderRadius: "8px", fontSize: "13px", cursor: "pointer", border: `1px solid ${guessMode === mode ? "#1D9E75" : "#ccc"}`, background: guessMode === mode ? "#E1F5EE" : "white", color: guessMode === mode ? "#0F6E56" : "#333" }}>
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p style={{ color: "#666", fontSize: "13px" }}>Mode: <strong>{guessMode === "both" ? "Song + Artist" : guessMode === "song" ? "Song only" : guessMode === "artist" ? "Artist only" : "Fill in lyrics"}</strong> (set by host)</p>
          )}
        </div>

        {room.players[0].id === socket.id && (
          <div style={{ marginBottom: "12px" }}>
            <p style={{ fontSize: "13px", color: "#999", marginBottom: "8px" }}>Number of questions</p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
              {[10, 15, 20].map(n => (
                <button key={n}
                  onClick={() => setQuestionCount(n)}
                  style={{ padding: "8px 18px", borderRadius: "8px", fontSize: "13px", cursor: "pointer", border: `1px solid ${questionCount === n ? "#1D9E75" : "#ccc"}`, background: questionCount === n ? "#E1F5EE" : "white", color: questionCount === n ? "#0F6E56" : "#333" }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {room.players[0].id === socket.id && (
          <button
            disabled={!room.players.every(p => p.genre) || !allAudioReady}
            style={{ display: "block", width: "100%", padding: "12px", fontSize: "15px", background: room.players.every(p => p.genre) && allAudioReady ? "#1D9E75" : "#ccc", color: "white", border: "none", borderRadius: "10px", cursor: room.players.every(p => p.genre) && allAudioReady ? "pointer" : "not-allowed", opacity: room.players.every(p => p.genre) && allAudioReady ? 1 : 0.5 }}
            onClick={() => {
              setError("")
              socket.emit("start_game", { code: room.code, guessMode, questionCount })
            }}
          >
            {!room.players.every(p => p.genre) ? "Waiting for all players..." : !allAudioReady ? `Players ready... (${audioReadyCount}/${room.players.length})` : "Start Game"}
          </button>
        )}

        <EmojiButtons />

        {error && <p style={{ color: "red", fontSize: "13px", marginTop: "8px" }}>{error}</p>}
      </div>
    )
  }

  // GAME SCREEN
  if (screen === "game") {
    return (
      <div style={{ padding: "20px 24px", width: "100%", maxWidth: "400px", margin: "0 auto", boxSizing: "border-box" }}>
        {!question && (
          <div style={{ textAlign: "center", marginTop: "60px" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>🎵</div>
            <h1 style={{ fontSize: "24px", animation: "pulse 1.5s ease-in-out infinite" }}>Get ready...</h1>
            <CountdownMessage />
          </div>
        )}
        {question && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", position: "relative" }}>
              <span style={{ fontSize: "11px", color: "#999" }}>Question {question.questionNumber} of {question.total}</span>
              <span style={{ fontSize: "13px", color: "#999", position: "absolute", left: "50%", transform: "translateX(-50%)" }}>
                {question.previewUrl ? "🎵 Now playing" : "No preview"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <button onClick={() => {
                  if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = "" }
                  localStorage.removeItem("roomCode")
                  localStorage.removeItem("playerName")
                  window.location.reload()
                }} style={{ fontSize: "12px", color: "#999", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Leave</button>
                <span style={{ fontSize: "20px", fontWeight: "600", color: timeLeft <= 5 ? "#E24B4A" : timeLeft <= 10 ? "#EF9F27" : "#1D9E75" }}>{timeLeft}s</span>
              </div>
            </div>
            <div style={{ height: "6px", background: "#eee", borderRadius: "4px", marginBottom: "12px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(timeLeft / 30) * 100}%`, background: timeLeft <= 5 ? "#E24B4A" : timeLeft <= 10 ? "#EF9F27" : "#1D9E75", borderRadius: "4px", transition: "width 1s linear" }} />
            </div>
            <p style={{ fontSize: "11px", color: "#999", marginBottom: "12px" }}>
              {lastAnswered && <span style={{ marginRight: "6px", transition: "opacity 0.5s" }}>{lastAnswered}  ···</span>}
              {answeredCount}/{room.players.length} answered
            </p>
            <div style={{ marginBottom: "16px" }}>
              {question.mode === "lyrics" ? (
                <div>
                  <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #eee", borderRadius: "10px", marginBottom: "12px", fontSize: "15px", lineHeight: "1.8", whiteSpace: "pre-line" }}>
                    {question.lyricLine}
                  </div>
                  <input
                    value={lyricsInput}
                    onChange={e => setLyricsInput(e.target.value)}
                    placeholder="Fill in the missing word..."
                    disabled={!!selectedAnswer}
                    onKeyDown={e => {
                      if (e.key === "Enter" && lyricsInput.trim()) {
                        const ans = lyricsInput.trim().toLowerCase()
                        setSelectedAnswer(ans)
                        socket.emit("submit_answer", { code: room.code, answer: ans })
                      }
                    }}
                    style={{ display: "block", width: "100%", padding: "12px", fontSize: "15px", border: "1px solid #ccc", borderRadius: "10px", boxSizing: "border-box", marginBottom: "8px" }}
                  />
                  <div style={{ position: "relative" }}>
                    <button
                      disabled={!!selectedAnswer}
                      onClick={() => {
                        if (lyricsInput.trim()) {
                          const ans = lyricsInput.trim().toLowerCase()
                          setSelectedAnswer(ans)
                          socket.emit("submit_answer", { code: room.code, answer: ans })
                        }
                      }}
                      style={{ display: "block", width: "100%", padding: "12px", fontSize: "15px", background: selectedAnswer ? "#ccc" : "#1D9E75", color: "white", border: "none", borderRadius: "10px", cursor: selectedAnswer ? "default" : "pointer" }}
                    >
                      {selectedAnswer ? "Answered!" : "Submit"}
                    </button>
                    {reveal && (
                      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "#E1F5EE", border: "1px solid #1D9E75", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <p style={{ fontSize: "13px", color: "#0F6E56", margin: 0 }}>✅ Correct: <strong>{question.answerDisplay || question.answer}</strong></p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                question.options.map((opt, i) => {
                  const isSelected = selectedAnswer === opt.name
                  const isCorrect = reveal && opt.name === reveal.name
                  const isWrong = reveal && isSelected && !isCorrect
                  return (
                    <button
                      key={i}
                      disabled={!!selectedAnswer}
                      onClick={() => {
                        setSelectedAnswer(opt.name)
                        socket.emit("submit_answer", { code: room.code, answer: opt.name })
                        if (question.correct && opt.name === question.correct.name) playSound("correct")
                        else playSound("wrong")
                      }}
                      style={{
                        display: "block", width: "100%", minHeight: "48px", padding: "12px 14px", marginBottom: "8px",
                        fontSize: "15px", textAlign: "left", borderRadius: "10px", cursor: selectedAnswer ? "default" : "pointer",
                        border: `1px solid ${isCorrect ? "#1D9E75" : isWrong ? "#E24B4A" : isSelected ? "#5cd8f1ff" : "#ccc"}`,
                        background: isCorrect ? "#E1F5EE" : isWrong ? "#FCEBEB" : isSelected ? "#97dbe8ff" : "white",
                        color: isCorrect ? "#0F6E56" : isWrong ? "#A32D2D" : "#333",
                        boxSizing: "border-box", wordBreak: "break-word"
                      }}
                    >
                      {opt.display || `${opt.name} — ${opt.artist}`}
                    </button>
                  )
                })
              )}
            </div>

            <EmojiButtons />

            <div style={{ borderTop: "1px solid #eee", paddingTop: "14px" }}>
              {(scores ? scores.players.map(p => ({ ...p, score: scores.scores[p.id] || 0 })) : room.players.map(p => ({ ...p, score: 0 })))
                .sort((a, b) => b.score - a.score)
                .map((p, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", marginBottom: "6px", background: "#f9f9f9", border: "1px solid #eee", borderRadius: "8px", fontSize: "14px" }}>
                    <span>
                      {results && results[p.id] ? results[p.id].correct ? "✅ " : results[p.id].answered ? "❌ " : "⏱️ " : ""}
                      {i + 1}. {p.name}
                      {results && results[p.id] && results[p.id].answer && !results[p.id].correct
                        ? <span style={{ fontSize: "12px", color: "#999", marginLeft: "6px" }}>"{results[p.id].answer}"</span>
                        : null
                      }
                    </span>
                    <strong>{p.score} pts</strong>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // GAME OVER SCREEN
  if (screen === "gameover") {
    const sortedPlayers = scores.players.map(p => ({ ...p, score: scores.scores[p.id] || 0 })).sort((a, b) => b.score - a.score)
    const sortedAllTime = Object.entries(allTimeScores).sort((a, b) => b[1] - a[1])
    return (
      <div style={{ padding: "80px 20px 24px", maxWidth: "400px", margin: "0 auto" }}>
        <div style={{ fontSize: "40px", marginBottom: "8px" }}>🏆</div>
        <h1 style={{ fontSize: "26px", marginBottom: "16px" }}>Game over!</h1>
        <div style={{ marginBottom: "16px" }}>
          {sortedPlayers.map((p, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #eee", fontSize: "16px" }}>
              <span>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`} {p.name}</span>
              <strong>{p.score} pts</strong>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          {room.players[0].id === socket.id
            ? <button style={{ flex: 1, padding: "12px", fontSize: "15px", background: "#1D9E75", color: "white", border: "none", borderRadius: "10px", cursor: "pointer" }} onClick={() => socket.emit("rematch", { code: room.code })}>🔄 Rematch</button>
            : <div style={{ flex: 1, padding: "12px", fontSize: "15px", background: "#f5f5f5", color: "#999", border: "1px solid #eee", borderRadius: "10px", textAlign: "center" }}>⏳ Waiting for host...</div>
          }
          <button style={{ flex: 1, padding: "12px", fontSize: "15px", background: "white", color: "#333", border: "1px solid #ccc", borderRadius: "10px", cursor: "pointer" }} onClick={() => {
            localStorage.removeItem("roomCode")
            localStorage.removeItem("playerName")
            window.location.reload()
          }}>Leave</button>
        </div>
        <div style={{ marginBottom: "24px" }}>
          <a href="https://ko-fi.com/chromakala" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-block", padding: "10px 20px", background: "#4caf50", color: "white", borderRadius: "8px", textDecoration: "none", fontSize: "14px", fontWeight: "500" }}>
            Support a late night coder ☕
          </a>
        </div>
        {sortedAllTime.length > 0 && (
          <div>
            <p style={{ fontSize: "16px", color: "#999", marginBottom: "10px" }}>📊 All-time scores this session</p>
            <div>
              {sortedAllTime.map(([name, score], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #eee", fontSize: "14px" }}>
                  <span>{i + 1}. {name}</span>
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