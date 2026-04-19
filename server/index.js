const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const cors = require("cors")
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))

const app = express()
app.use(cors({
  origin: "*"
}))

const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
})

const rooms = {}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let code = ""
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

async function startQuestion(io, room) {
  if (room.currentQuestion >= room.totalQuestions) {
    io.to(room.code).emit("game_over", { scores: room.scores, players: room.players })
    return
  }

  const tracks = room.tracks
  const available = tracks.filter(t => !room.usedTrackNames.has(t.name))
  if (available.length < 4) {
    room.usedTrackNames = new Set()
  }
  const pool = available.length >= 4 ? available : tracks
  const correct = pool[Math.floor(Math.random() * pool.length)]
  room.usedTrackNames.add(correct.name)
  const wrong = tracks
    .filter(t => t.name !== correct.name)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)

  const options = [...wrong, correct].sort(() => Math.random() - 0.5)

  room.currentCorrect = correct
  room.questionStartTime = Date.now()
  room.answers = {}

  let previewUrl = null
  try {
    const q = encodeURIComponent(`${correct.name} ${correct.artist}`)
    const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`)
    const data = await res.json()
    if (data.data && data.data.length > 0) {
      previewUrl = data.data[0].preview
    }
  } catch(e) {
    console.error("Deezer fetch failed", e)
  }

  console.log(`Q${room.currentQuestion + 1}: ${correct.name} - preview: ${previewUrl ? "found" : "none"}`)

  io.to(room.code).emit("new_question", {
    questionNumber: room.currentQuestion + 1,
    total: room.totalQuestions,
    correct: { name: correct.name, artist: correct.artist },
    previewUrl,
    options: options.map(t => ({ name: t.name, artist: t.artist }))
  })

  room.questionTimer = setTimeout(() => {
    revealAnswer(io, room)
  }, 30000)
}

function revealAnswer(io, room) {
  clearTimeout(room.questionTimer)
  const results = {}
  room.players.forEach(p => {
    const answer = room.answers[p.id]
    results[p.id] = {
      answered: !!answer,
      correct: answer === room.currentCorrect.name
    }
  })
  io.to(room.code).emit("reveal_answer", {
    correct: { name: room.currentCorrect.name, artist: room.currentCorrect.artist },
    scores: room.scores,
    players: room.players,
    results
  })
  room.currentQuestion++
  setTimeout(() => startQuestion(io, room), 3000)
}

io.on("connection", (socket) => {
  console.log("player connected:", socket.id)

  socket.on("create_room", ({ playerName }) => {
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

  socket.on("join_room", ({ code, playerName }) => {
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

  socket.on("select_genre", ({ code, genre, tracks }) => {
    const room = rooms[code]
    if (!room) return
    const player = room.players.find(p => p.id === socket.id)
    if (player) {
      player.genre = genre
      player.tracks = tracks
      io.to(code).emit("room_updated", { players: room.players })
    }
  })

  socket.on("start_game", ({ code, questionCount }) => {
    const room = rooms[code]
    if (!room) return
    if (room.host !== socket.id) return
    const allReady = room.players.every(p => p.genre)
    if (!allReady) {
      socket.emit("error", { message: "All players must pick a genre first!" })
      return
    }

    let allTracks = []
    for (const player of room.players) {
      if (player.tracks) {
        allTracks = allTracks.concat(player.tracks)
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

    // Shuffle tracks randomly
      const shuffled = unique.sort(() => Math.random() - 0.5)
      room.tracks = shuffled
      room.usedTrackNames = new Set()
      room.scores = {}
      room.players.forEach(p => room.scores[p.id] = 0)
      room.currentQuestion = 0
      room.totalQuestions = Math.min(questionCount && questionCount > 0 ? questionCount : 20, unique.length)

    io.to(code).emit("game_starting")
    setTimeout(() => startQuestion(io, room), 3000)
  })

  socket.on("submit_answer", ({ code, answer }) => {
    const room = rooms[code]
    if (!room || room.answers[socket.id]) return
    room.answers[socket.id] = answer
    const correct = room.currentCorrect
    if (answer === correct.name) {
      const timeBonus = Math.max(0, 1000 - (Date.now() - room.questionStartTime) / 30)
      room.scores[socket.id] = (room.scores[socket.id] || 0) + Math.round(timeBonus)
    }

    const answeredCount = Object.keys(room.answers).length
    io.to(code).emit("answer_count", { count: answeredCount })

    if (answeredCount >= room.players.length) {
      clearTimeout(room.questionTimer)
      revealAnswer(io, room)
    }
  })

  socket.on("disconnect", () => {
    for (const code in rooms) {
      const room = rooms[code]
      room.players = room.players.filter(p => p.id !== socket.id)
      if (room.players.length === 0) {
        delete rooms[code]
        console.log(`room ${code} deleted`)
      } else {
        io.to(code).emit("room_updated", { players: room.players })
      }
    }
  })
})

server.listen(process.env.PORT || 3001, () => {
  console.log("server running on http://127.0.0.1:3001")
})