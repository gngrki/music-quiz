const disconnectTimers = {}
const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const cors = require("cors")
const rateLimit = require("express-rate-limit")
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))

const app = express()
app.use(cors({ origin: "https://music-quiz-zeta.vercel.app" }))
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
}))

const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: "https://music-quiz-zeta.vercel.app",
    methods: ["GET", "POST"]
  }
})

const rooms = {}

function generateRoomCode() {
  const chars = "abcdefghijklmnopqrstuvwxy"
  let code = ""
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}
function normalizeEstonian(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/õ/g, "o")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
}
function isCloseEnough(answer, correct) {
  const a = normalizeContractions(normalizeEstonian(answer))
  const c = normalizeContractions(normalizeEstonian(correct))
  if (a === c) return 1
  if (a + "s" === c) return 0.5
  if (c + "s" === a) return 0.5
  if (a + "es" === c) return 0.5
  if (c + "es" === a) return 0.5
  return 0
}
function normalizeContractions(str) {
  return str
    .replace(/can't/g, "cannot")
    .replace(/cannot/g, "cannot")
    .replace(/won't/g, "will not")
    .replace(/don't/g, "do not")
    .replace(/doesn't/g, "does not")
    .replace(/didn't/g, "did not")
    .replace(/isn't/g, "is not")
    .replace(/aren't/g, "are not")
    .replace(/wasn't/g, "was not")
    .replace(/weren't/g, "were not")
    .replace(/i'm/g, "i am")
    .replace(/i've/g, "i have")
    .replace(/i'll/g, "i will")
    .replace(/i'd/g, "i would")
    .replace(/you're/g, "you are")
    .replace(/you've/g, "you have")
    .replace(/you'll/g, "you will")
    .replace(/they're/g, "they are")
    .replace(/they've/g, "they have")
    .replace(/we're/g, "we are")
    .replace(/we've/g, "we have")
    .replace(/it's/g, "it is")
    .replace(/that's/g, "that is")
    .replace(/there's/g, "there is")
    .replace(/wouldn't/g, "would not")
    .replace(/couldn't/g, "could not")
    .replace(/shouldn't/g, "should not")
    .replace(/haven't/g, "have not")
    .replace(/hadn't/g, "had not")
    .replace(/mustn't/g, "must not")
}
const fillerWords = new Set([
  "yeah", "yea", "ohh", "ooh", "ahh", "aah", "hey", "woah", "whoa",
  "mmm", "hmm", "ugh", "nah", "yep", "nope", "woo", "hoo", "boo",
  "aye", "ole", "sha", "bam", "pow", "wow", "aww", "awww", "huh",
  "mhm", "ugh", "brr", "shh", "psst", "tsk", "yay", "wee", "whee"
])

function isRepetition(word) {
  for (let len = 1; len <= Math.floor(word.length / 2); len++) {
    const unit = word.slice(0, len)
    const repeated = unit.repeat(Math.ceil(word.length / len)).slice(0, word.length)
    if (repeated === word) return true
  }
  return false
}

function isValidLyricWord(word) {
  const w = word.toLowerCase().replace(/[^a-zõäöü]/g, "")
  if (w.length <= 2) return false
  if (fillerWords.has(w)) return false
  if (isRepetition(w)) return false
  return true
}

async function fetchLyrics(name, artist) {
  try {
    const res = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(name)}`)
    const data = await res.json()
    if (!data.lyrics) return null
    const lines = data.lyrics
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 20 && !l.includes("(") && !l.includes(")"))
    if (lines.length < 2) return null
    const idx = Math.floor(Math.random() * lines.length)
    const line = lines[idx]
    const words = line.split(" ").filter(w => isValidLyricWord(w))
    if (words.length === 0) return null
    const word = words[Math.floor(Math.random() * words.length)]
    const blanked = line.replace(word, "_____")
    const before = idx > 0 ? lines[idx - 1] : ""
    const after = idx < lines.length - 1 ? lines[idx + 1] : ""
    const display = [before, blanked].filter(l => l).join("\n")
    return { line: display, answer: word.toLowerCase().replace(/[^a-zõäöü]/g, ""), answerDisplay: word.toLowerCase() }
  } catch(e) {
    return null
  }
}
  async function prefetchNext(room, tracks) {
    const available = tracks.filter(t => !room.usedTrackNames.has(t.name))
    const pool = available.length >= 4 ? available : tracks
    const attempted = new Set()

    while (attempted.size < pool.length) {
      const candidate = pool[Math.floor(Math.random() * pool.length)]
      if (attempted.has(candidate.name)) continue
      attempted.add(candidate.name)

      try {
        const q = encodeURIComponent(`${candidate.name} ${candidate.artist}`)
        const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`)
        const data = await res.json()
        if (!data.data || !data.data.length || !data.data[0].preview) continue

        const previewUrl = data.data[0].preview

        if (room.guessMode === "lyrics") {
          const lyrics = await fetchLyrics(candidate.name, candidate.artist)
          if (!lyrics) continue
          if (!room.prefetched) room.prefetched = []
          room.prefetched.push({ correct: candidate, previewUrl, lyrics })
        } else {
        if (!room.prefetched) room.prefetched = []
        room.prefetched.push({ correct: candidate, previewUrl })
        }
        room.usedTrackNames.add(candidate.name)
        return
      } catch(e) {
        continue
      }
    }
  }

async function startQuestion(io, room) {
  if (room.currentQuestion >= room.totalQuestions) {
    io.to(room.code).emit("game_over", { scores: room.scores, players: room.players })
    return
  }
  if (room.players.length === 0) {
    delete rooms[room.code]
    console.log(`room ${room.code} deleted - no players left`)
    return
  }

  const tracks = room.tracks
  let correct, previewUrl, lyrics

  if (room.prefetched && room.prefetched.length > 0) {
    const next = room.prefetched.shift()
    correct = next.correct
    previewUrl = next.previewUrl
    lyrics = next.lyrics
  } else {
    // first question — fetch normally
    const available = tracks.filter(t => !room.usedTrackNames.has(t.name))
    if (available.length < 4) room.usedTrackNames = new Set()
    const pool = available.length >= 4 ? available : tracks
    const attempted = new Set()

    while (!previewUrl && attempted.size < pool.length) {
      const candidate = pool[Math.floor(Math.random() * pool.length)]
      if (attempted.has(candidate.name)) continue
      attempted.add(candidate.name)
      try {
        const q = encodeURIComponent(`${candidate.name} ${candidate.artist}`)
        const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`)
        const data = await res.json()
        if (data.data && data.data.length > 0 && data.data[0].preview) {
          correct = candidate
          previewUrl = data.data[0].preview
        }
      } catch(e) {
        console.error("Deezer fetch failed", e)
      }
    }

    if (!correct) {
      correct = pool[Math.floor(Math.random() * pool.length)]
    }

    room.usedTrackNames.add(correct.name)

    if (room.guessMode === "lyrics") {
      lyrics = await fetchLyrics(correct.name, correct.artist)
      if (!lyrics) {
        return startQuestion(io, room)
      }
    }
  }

  // kick off prefetch for next question in background
  prefetchNext(room, tracks)
  prefetchNext(room, tracks)

  const wrong = tracks
  .filter(t => t.name !== correct.name && t.artist !== correct.artist)
  .filter((t, i, arr) => arr.findIndex(x => x.artist === t.artist) === i) // dedupe by artist
  .sort(() => Math.random() - 0.5)
  .slice(0, 3)

  const options = [...wrong, correct].sort(() => Math.random() - 0.5)

  room.currentCorrect = correct
  room.questionStartTime = Date.now()
  room.answers = {}

  console.log(`Q${room.currentQuestion + 1}: ${correct.name} - preview: ${previewUrl ? "found" : "none"}`)

  if (room.guessMode === "lyrics") {
    room.currentCorrect = { ...correct, lyricsAnswer: lyrics.answer }
    io.to(room.code).emit("new_question", {
      questionNumber: room.currentQuestion + 1,
      total: room.totalQuestions,
      correct: { name: correct.name, artist: correct.artist },
      mode: "lyrics",
      lyricLine: lyrics.line,
      answer: lyrics.answer,
      answerDisplay: lyrics.answerDisplay,
      previewUrl
    })
  } else {
    io.to(room.code).emit("new_question", {
      questionNumber: room.currentQuestion + 1,
      total: room.totalQuestions,
      correct: {
        name: correct.name,
        artist: correct.artist,
        display: room.guessMode === "song" ? correct.name : room.guessMode === "artist" ? correct.artist : `${correct.name} — ${correct.artist}`
      },
      previewUrl,
      options: options.map(t => ({
        name: t.name,
        artist: t.artist,
        display: room.guessMode === "song" ? t.name : room.guessMode === "artist" ? t.artist : `${t.name} — ${t.artist}`
      }))
    })
  }

  room.currentQuestion++

  room.questionTimer = setTimeout(() => {
    revealAnswer(io, room)
  }, 30000)
}

function revealAnswer(io, room) {
  clearTimeout(room.questionTimer)
  if (room.players.length === 0) {
    delete rooms[room.code]
    console.log(`room ${room.code} deleted - no players left`)
    return
  }
  const results = {}
  room.players.forEach(p => {
    const answer = room.answers[p.id]
    const answeredOption = answer ? room.tracks.find(t => t.name === answer) : null
    results[p.id] = {
      answered: !!answer,
      correct: room.currentCorrect.lyricsAnswer 
        ? isCloseEnough(answer || "", room.currentCorrect.lyricsAnswer) > 0
        : answer === room.currentCorrect.name,
      answer: answer || null,
      artistAnswer: room.guessMode === "artist" && answeredOption ? answeredOption.artist : null
    }
  })

  io.to(room.code).emit("reveal_answer", {
    correct: { name: room.currentCorrect.name, artist: room.currentCorrect.artist },
    scores: room.scores,
    players: room.players,
    results
  })
  setTimeout(() => startQuestion(io, room), 3000)
}

setInterval(() => {
  for (const code in rooms) {
    const room = rooms[code]
    if (room.players.length === 0) {
      delete rooms[code]
    }
  }
}, 60 * 60 * 1000)

function countActivePlayers() {
  let count = 0
  for (const code in rooms) {
    count += rooms[code].players.length
  }
  return count
}

io.on("connection", (socket) => {
  io.emit("player_count", { count: countActivePlayers() })
  console.log("player connected:", socket.id)

  socket.on("create_room", ({ playerName }) => {
    if (!playerName || playerName.length > 7) return
    let code = generateRoomCode()
    while (rooms[code]) code = generateRoomCode()
    rooms[code] = {
      code,
      host: socket.id,
      players: [{ id: socket.id, name: playerName, genre: null }]
    }
    socket.join(code)
    socket.emit("room_created", { code, players: rooms[code].players })
    console.log(`room ${code} created by ${playerName}`)
  })
  socket.on("check_room", ({ code }) => {
    const room = rooms[code]
    if (!room) {
      socket.emit("error", { message: "Room not found!" })
      return
    }
    if (room.players.length >= 6) {
      socket.emit("error", { message: "Room is full!" })
      return
    }
    socket.emit("room_valid")
  })
  socket.on("join_room", ({ code, playerName }) => {
    if (!playerName || playerName.length > 7) return
    const room = rooms[code]
    if (!room) {
      socket.emit("error", { message: "Room not found!" })
      return
    }
    if (room.players.length >= 6) {
      socket.emit("error", { message: "Room is full!" })
      return
    }
    room.players.push({ id: socket.id, name: playerName, genre: null })
    socket.join(code)
    io.to(code).emit("room_updated", { players: room.players })
    socket.emit("room_joined", { code, players: room.players })
    console.log(`${playerName} joined room ${code}`)
  })
  socket.on("kick_player", ({ code, playerId }) => {
    const room = rooms[code]
    if (!room || room.host !== socket.id) return
    const idx = room.players.findIndex(p => p.id === playerId)
    if (idx === -1) return
    room.players.splice(idx, 1)
    const kickedSocket = io.sockets.sockets.get(playerId)
    if (kickedSocket) kickedSocket.emit("kicked")
    io.to(code).emit("room_updated", { players: room.players })
  })

  socket.on("select_genre", ({ code, genre, tracks }) => {
    if (!genre || genre.length > 50) return
    if (!tracks || tracks.length > 200) return
    const room = rooms[code]
    if (!room) return
    const player = room.players.find(p => p.id === socket.id)
    if (player) {
      player.genre = genre
      player.tracks = tracks
      io.to(code).emit("room_updated", { players: room.players })
    }
  })

  socket.on("host_override", ({ code, playerId }) => {
    const room = rooms[code]
    if (!room || room.host !== socket.id) return
    if (room.hostOverride === playerId) {
      room.hostOverride = null
    } else {
      room.hostOverride = playerId
    }
    io.to(code).emit("host_override_updated", { hostOverride: room.hostOverride })
  })

  socket.on("start_game", ({ code, questionCount, guessMode }) => {
    const room = rooms[code]
    if (!room) return
    if (room.host !== socket.id) return
    const allReady = room.players.every(p => p.genre)
    if (!allReady) {
      socket.emit("error", { message: "All players must pick a genre first!" })
      return
    }

    let allTracks = []
    if (room.hostOverride) {
      const overriddenPlayer = room.players.find(p => p.id === room.hostOverride)
      if (overriddenPlayer && overriddenPlayer.tracks) {
        allTracks = overriddenPlayer.tracks
      }
    } else {
      for (const player of room.players) {
        if (player.tracks) {
          allTracks = allTracks.concat(player.tracks)
        }
      }
    }

    const unique = []
    const seen = new Set()
    for (const t of allTracks) {
      if (!seen.has(t.name)) {
        seen.add(t.name)
        unique.push(t)
      }
    }

    if (unique.length < 4) {
      socket.emit("error", { message: "Not enough tracks found! Try different genres." })
      return
    }

    const playerTracks = room.players.map(p => 
      (p.tracks || []).filter(t => !seen.has(t.name) || true).sort(() => Math.random() - 0.5)
    )
    const interleaved = []
    const maxLen = Math.max(...playerTracks.map(t => t.length))
    for (let i = 0; i < maxLen; i++) {
      for (let j = 0; j < playerTracks.length; j++) {
        if (playerTracks[j][i]) interleaved.push(playerTracks[j][i])
      }
    }
    const seen2 = new Set()
    const deduped = interleaved.filter(t => {
      if (seen2.has(t.name)) return false
      seen2.add(t.name)
      return true
    })
    room.tracks = room.hostOverride ? allTracks.sort(() => Math.random() - 0.5) : deduped
    room.usedTrackNames = new Set()
    room.scores = {}
    room.players.forEach(p => room.scores[p.id] = 0)
    room.currentQuestion = 0
    room.totalQuestions = Math.min(questionCount && questionCount > 0 ? questionCount : 15, unique.length)
    room.guessMode = guessMode || "both"

    io.to(code).emit("game_starting", { guessMode: room.guessMode })
    setTimeout(() => startQuestion(io, room), 3000)
  })

  socket.on("submit_answer", ({ code, answer }) => {
    const room = rooms[code]
    if (!room || room.answers[socket.id]) return
    room.answers[socket.id] = answer
    const correct = room.currentCorrect
    const lyricMatch = room.currentCorrect.lyricsAnswer 
      ? isCloseEnough(answer, room.currentCorrect.lyricsAnswer)
      : (answer === correct.name ? 1 : 0)

    if (lyricMatch > 0) {
      const timeBonus = Math.max(0, 250 - (Date.now() - room.questionStartTime) / 120)
      const flatBonus = Math.round(250 * lyricMatch)
      const correctSoFar = Object.values(room.answers).filter(a => 
        room.currentCorrect.lyricsAnswer
          ? isCloseEnough(a, room.currentCorrect.lyricsAnswer) > 0
          : a === room.currentCorrect.name
      ).length
      const totalPlayers = room.players.length
      const positionBonus = Math.round(20 * (1 - correctSoFar / totalPlayers))
      room.scores[socket.id] = (room.scores[socket.id] || 0) + Math.round(timeBonus) + flatBonus + positionBonus
    }
const answeredCount = Object.keys(room.answers).length
    const answeredPlayer = room.players.find(p => p.id === socket.id)
    io.to(code).emit("answer_count", { count: answeredCount, playerName: answeredPlayer ? answeredPlayer.name : "" })

    if (answeredCount >= room.players.length) {
      clearTimeout(room.questionTimer)
      revealAnswer(io, room)
    }
  })

  socket.on("rematch", ({ code }) => {
    const room = rooms[code]
    if (!room) return
    if (room.host !== socket.id) return
    room.players.forEach(p => {
      p.genre = null
      p.tracks = null
    })
    room.currentQuestion = 0
    room.tracks = []
    room.scores = {}
    room.answers = {}
    room.usedTrackNames = new Set()
    room.audioReady = new Set()
    room.prefetched = []
    room.hostOverride = null
    io.to(code).emit("rematch_starting")
    
  })

  socket.on("set_guess_mode", ({ code, guessMode }) => {
    const room = rooms[code]
    if (!room) return
    if (room.host !== socket.id) return
    room.guessMode = guessMode
    socket.to(code).emit("guess_mode_updated", { guessMode })
  })

  socket.on("rejoin_room", ({ code, playerName }) => {
  const room = rooms[code]
  if (!room) {
    socket.emit("error", { message: "Room no longer exists!" })
    return
  }
  const timerKey = `${code}:${playerName}`
  if (disconnectTimers[timerKey]) {
    clearTimeout(disconnectTimers[timerKey])
    delete disconnectTimers[timerKey]
  }
  const existingPlayer = room.players.find(p => p.name === playerName)
  if (existingPlayer) {
    const wasHost = room.host === existingPlayer.id
    existingPlayer.id = socket.id
    if (wasHost) room.host = socket.id
  } else {
    room.players.push({ id: socket.id, name: playerName, genre: null })
  }
  socket.join(code)
  io.to(code).emit("room_updated", { players: room.players })
  socket.emit("room_joined", { code, players: room.players })
  console.log(`${playerName} rejoined room ${code}`)
})
  socket.on("send_emoji", ({ code, playerName, emoji }) => {
    const room = rooms[code]
    if (!room) return
    const id = Date.now() + Math.random()
    io.to(code).emit("emoji_reaction", { playerName, emoji, id })
  })
  socket.on("audio_ready", ({ code }) => {
    const room = rooms[code]
    if (!room) return
    if (!room.audioReady) room.audioReady = new Set()
    room.audioReady.add(socket.id)
    io.to(code).emit("audio_ready_update", { count: room.audioReady.size, total: room.players.length })
  })
  socket.on("disconnect", () => {
  for (const code in rooms) {
    const room = rooms[code]
    const player = room.players.find(p => p.id === socket.id)
    if (player) {
      const playerName = player.name
      disconnectTimers[`${code}:${playerName}`] = setTimeout(() => {
        const r = rooms[code]
        if (!r) return
        const idx = r.players.findIndex(p => p.name === playerName)
        if (idx !== -1) {
          r.players.splice(idx, 1)
          if (r.players.length === 0) {
            clearTimeout(r.questionTimer)
            delete rooms[code]
            console.log(`room ${code} deleted`)
          } else {
            if (r.host === socket.id) {
              r.host = r.players[0].id
            }
            io.to(code).emit("room_updated", { players: r.players })
          }
        }
        io.emit("player_count", { count: countActivePlayers() })
        delete disconnectTimers[`${code}:${playerName}`]
      }, 60000)
    }
  }
})
})

server.listen(process.env.PORT || 3001, () => {
  console.log("server running on http://127.0.0.1:3001")
})