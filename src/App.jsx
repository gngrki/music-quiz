import { useState, useEffect, useRef } from "react"
import { io } from "socket.io-client"

const socket = io("https://music-quiz-production-b8f9.up.railway.app")
const LASTFM_KEY = "5ae7aaa16891fc49403d389293103d97"

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

  useEffect(() => {
    socket.on("room_created", ({ code, players }) => {
      setRoom({ code, players })
      setScreen("lobby")
    })

    socket.on("room_joined", ({ code, players }) => {
      setRoom({ code, players })
      setScreen("lobby")
    })

    socket.on("room_updated", ({ players }) => {
      setRoom(prev => ({ ...prev, players }))
    })

    socket.on("game_starting", ({ guessMode }) => {
      setGuessMode(guessMode)
      setScreen("game")
    })

    socket.on("new_question", (data) => {
      setQuestion(data)
      setSelectedAnswer(null)
      setReveal(null)
      setResults(null)
      setTimeLeft(30)
      setAnsweredCount(0)
      if (data.previewUrl && audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = data.previewUrl
        audioRef.current.load()
        audioRef.current.play().catch(e => console.log("play failed:", e))
      }
    })

    socket.on("answer_count", ({ count }) => {
      setAnsweredCount(count)
    })

    socket.on("reveal_answer", ({ correct, scores, players, results }) => {
      setReveal(correct)
      setScores({ scores, players })
      setResults(results)
      if (timerRef.current) clearInterval(timerRef.current)
      if (audioRef.current) {
         audioRef.current.pause()
        }
    })

    socket.on("game_over", ({ scores, players }) => {
      setScores({ scores, players })
      setAllTimeScores(prev => {
        const updated = { ...prev }
        players.forEach(p => {
          updated[p.name] = (updated[p.name] || 0) + (scores[p.id] || 0)
        })
        return updated
      })
      setScreen("gameover")
    })
    socket.on("rematch_starting", () => {
      setScreen("lobby")
      setQuestion(null)
      setSelectedAnswer(null)
      setReveal(null)
      setResults(null)
      setScores(null)
      setConfirmedGenre(false)
      setGenre("")
      setAudioUnlocked(false)
      setTimeLeft(30)
      setAnsweredCount(0)
    })
    socket.on("error", ({ message }) => {
      setError(message)
    })

    return () => {
      socket.off("room_created")
      socket.off("room_joined")
      socket.off("room_updated")
      socket.off("game_starting")
      socket.off("new_question")
      socket.off("answer_count")
      socket.off("reveal_answer")
      socket.off("game_over")
      socket.off("rematch_starting")
      socket.off("error")
    }
  }, [])

  useEffect(() => {
    if (!question || reveal) return
    if (timerRef.current) clearInterval(timerRef.current)
    setTimeLeft(30)
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [question])

  if (screen === "home") {
    return (
      <div style={{ padding: 20 }}>
        <h1>🎵 Music Quiz 🎶</h1>
        <p>What's your name?</p>
        <input
          value={playerName}
          onChange={e => setPlayerName(e.target.value)}
          placeholder="Enter your name"
          style={{ padding: "8px", marginRight: "8px" }}
        />
        <br /><br />
        <button
          style={{ marginRight: "8px" }}
          onClick={() => {
            if (!playerName.trim()) return setError("Enter your name first!")
            socket.emit("create_room", { playerName })
          }}
        >
          Create Room
        </button>
        <button
          onClick={() => {
            if (!playerName.trim()) return setError("Enter your name first!")
            setScreen("join")
          }}
        >
          Join Room
        </button>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    )
  }

  if (screen === "join") {
    return (
      <div style={{ padding: 20 }}>
        <h1>Join a Room</h1>
        <input
          value={roomCode}
          onChange={e => setRoomCode(e.target.value.toUpperCase())}
          placeholder="Enter room code"
          style={{ padding: "8px", marginRight: "8px" }}
        />
        <button onClick={() => {
          if (!roomCode.trim()) return setError("Enter a room code!")
          socket.emit("join_room", { code: roomCode, playerName })
        }}>
          Join
        </button>
        <br /><br />
        <button onClick={() => setScreen("home")}>Back</button>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    )
  }

  if (screen === "lobby") {
    return (
      <div style={{ padding: 20 }}>
        <h1>Lobby</h1>
        <p>Room code: <strong>{room.code}</strong></p>
        <h3>Players ({room.players.length}/6)</h3>
        {!audioUnlocked && (
          <button
            style={{ padding: "12px 24px", fontSize: "16px", marginBottom: "16px", background: "#4caf50", color: "white", border: "none", borderRadius: "8px", cursor: "pointer" }}
            onClick={() => {
              const audio = new Audio()
              audio.volume = 1
              audioRef.current = audio
              audio.play().catch(() => {})
              setAudioUnlocked(true)
            }}
          >
            🎵 Tap to enable music
          </button>
        )}
        {audioUnlocked && <p style={{ color: "#4caf50" }}>✅ Music enabled!</p>}
        {room.players.map((p, i) => (
         <div key={i} style={{ padding: "8px", borderBottom: "1px solid #ccc" }}>
           {p.name} {p.genre ? `✅ ${p.genre}` : "⏳"}
         </div>
        ))}
        <br />
        {!confirmedGenre && (
          <div>
            <h3>Pick a music genre or artist</h3>
            <input
              value={genre}
              onChange={e => setGenre(e.target.value)}
              placeholder="e.g. pop, rock, taylor swift"
              style={{ padding: "8px", marginRight: "8px", width: "250px" }}
            />
            <button
              onClick={async () => {
                if (!genre.trim()) return setError("Enter a genre or artist!")
                setError("")
                const tracks = await getTopTracks(genre)
                if (!tracks || tracks.length < 4) return setError("Couldn't find enough tracks! Try a different genre.")
                socket.emit("select_genre", {
                  code: room.code,
                  genre,
                  tracks
                })
                setConfirmedGenre(true)
              }}
            >
              Confirm
            </button>
            {error && <p style={{ color: "red" }}>{error}</p>}
            <h3>What to guess?</h3>
              <div style={{ marginBottom: "12px" }}>
                <button
                  onClick={() => setGuessMode("both")}
                  style={{ marginRight: "8px", padding: "6px 12px", background: guessMode === "both" ? "#4caf50" : "#eee", color: guessMode === "both" ? "white" : "black", border: "none", borderRadius: "6px", cursor: "pointer" }}
                >
                  🎵 Song + Artist 🎤
                </button>
                <button
                  onClick={() => setGuessMode("song")}
                  style={{ marginRight: "8px", padding: "6px 12px", background: guessMode === "song" ? "#4caf50" : "#eee", color: guessMode === "song" ? "white" : "black", border: "none", borderRadius: "6px", cursor: "pointer" }}
                >
                  🎵 Song only
                </button>
                <button
                  onClick={() => setGuessMode("artist")}
                  style={{ padding: "6px 12px", background: guessMode === "artist" ? "#4caf50" : "#eee", color: guessMode === "artist" ? "white" : "black", border: "none", borderRadius: "6px", cursor: "pointer" }}
                >
                  🎤 Artist only
                </button>
              </div>
          </div>
        )}
        {confirmedGenre && (
          <p>✅ Genre confirmed: <strong>{genre}</strong></p>
        )}
        <br />
        {room.players[0].id === socket.id && (
          <button onClick={() => {
            setError("")
            socket.emit("start_game", { code: room.code, guessMode })
          }}>
            Start Game
          </button>
        )}
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    )
  }

  if (screen === "game") {
    return (
      <div style={{ padding: 20 }}>
        {!question && <h1>🎮 Get ready...</h1>}
        {question && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0 }}>Question {question.questionNumber} of {question.total}</h3>
              <div style={{
                fontSize: "24px",
                fontWeight: "bold",
                color: timeLeft <= 5 ? "red" : timeLeft <= 10 ? "orange" : "green"
              }}>
                ⏱ {timeLeft}s
              </div>
            </div>

            <div style={{ marginBottom: "8px", color: "#666" }}>
              🎵 {question.previewUrl ? "Now playing..." : "No preview available for this track"}
            </div>

            <div style={{ marginBottom: "8px", color: "#666", fontSize: "14px" }}>
              {answeredCount} / {room.players.length} answered
            </div>

            <div style={{ marginBottom: "16px", height: "8px", background: "#eee", borderRadius: "4px" }}>
              <div style={{
                height: "100%",
                width: `${(timeLeft / 30) * 100}%`,
                background: timeLeft <= 5 ? "red" : timeLeft <= 10 ? "orange" : "green",
                borderRadius: "4px",
                transition: "width 1s linear"
              }} />
            </div>

            <div>
              {question.options.map((opt, i) => (
                <button
                  key={i}
                  disabled={!!selectedAnswer}
                  onClick={() => {
                    setSelectedAnswer(opt.name)
                    socket.emit("submit_answer", {
                      code: room.code,
                      answer: opt.name
                    })
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "12px",
                    marginBottom: "8px",
                    background: reveal
                      ? opt.name === reveal.name
                        ? "#4caf50"
                        : selectedAnswer === opt.name
                          ? "#f44336"
                          : "#eee"
                      : selectedAnswer === opt.name
                        ? "#ddd"
                        : "white",
                    border: "1px solid #ccc",
                    cursor: selectedAnswer ? "default" : "pointer",
                    fontSize: "16px",
                    textAlign: "left"
                  }}
                >
                  {opt.display || `${opt.name} — ${opt.artist}`}
                </button>
              ))}
            </div>

            {reveal && (
              <div style={{ marginTop: "16px" }}>
                <p>✅ Correct: <strong>{reveal.name}</strong> by {reveal.artist}</p>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: "24px", borderTop: "1px solid #eee", paddingTop: "12px" }}>
  <h4 style={{ marginBottom: "8px" }}>Scoreboard</h4>
            {scores ? (
              scores.players
                .map(p => ({ ...p, score: scores.scores[p.id] || 0 }))
                .sort((a, b) => b.score - a.score)
                .map((p, i) => (
                  <div key={i} style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 12px",
                    marginBottom: "4px",
                    background: "#f5f5f5",
                    borderRadius: "8px",
                    fontSize: "15px"
                  }}>
                    <span>
                      {results && results[p.id]
                        ? results[p.id].correct ? "✅ " : results[p.id].answered ? "❌ " : "⏱️ "
                        : ""
                      }
                      {i + 1}. {p.name}
                    </span>
                    <strong>{p.score} pts</strong>
                  </div>
                ))
            ) : (
              room.players.map((p, i) => (
                <div key={i} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 12px",
                  marginBottom: "4px",
                  background: "#f5f5f5",
                  borderRadius: "8px",
                  fontSize: "15px"
                }}>
                  <span>{i + 1}. {p.name}</span>
                  <strong>0 pts</strong>
                </div>
              ))
            )}
          </div>
      </div>
    )
  }

  if (screen === "gameover") {
  const sortedPlayers = scores.players
    .map(p => ({ ...p, score: scores.scores[p.id] || 0 }))
    .sort((a, b) => b.score - a.score)

  const sortedAllTime = Object.entries(allTimeScores)
    .sort((a, b) => b[1] - a[1])

  return (
    <div style={{ padding: 20 }}>
      <h1>🏆 Game Over!</h1>
      {sortedPlayers.map((p, i) => (
        <div key={i} style={{ padding: "10px", borderBottom: "1px solid #ccc", fontSize: "18px" }}>
          {i + 1}. {p.name} — {p.score} points
        </div>
      ))}
      <br />
       {room.players[0].id === socket.id ? (
        <button onClick={() => socket.emit("rematch", { code: room.code })}>
          🔄 Rematch (same players)
        </button>
      ) : (
        <p>⏳ Waiting for host to start rematch...</p>
      )}
      <button 
        style={{ marginLeft: "8px" }}
        onClick={() => window.location.reload()}
      >
        Leave
      </button>

      {sortedAllTime.length > 0 && (
        <div style={{ marginTop: "32px" }}>
          <h3>📊 All-time scores (this session)</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "15px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #ccc" }}>
                <th style={{ textAlign: "left", padding: "8px" }}>Player</th>
                <th style={{ textAlign: "right", padding: "8px" }}>Total pts</th>
              </tr>
            </thead>
            <tbody>
              {sortedAllTime.map(([name, score], i) => (
                <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "8px" }}>{i + 1}. {name}</td>
                  <td style={{ textAlign: "right", padding: "8px" }}><strong>{score}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
}