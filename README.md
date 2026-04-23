# [🎵 Music Quiz (link)](https://music-quiz-zeta.vercel.app)
A real-time online multiplayer music quiz game built with React, Node.js, and Socket.IO.  
Built by me and used AI tools to speed up development.  
*I made all architectural decisions and debugged issues myself. I understand how the system works end-to-end.* :)

### Features
> * Up to 6 players per room
> * Real-time multiplayer via Socket.IO
> * Music previews from Deezer
> * Four guess modes: Song + Artist, Song only, Artist only, Fill in lyrics
> * Timer and live scoreboard with position and speed bonuses
> * Emoji reactions that fly across the screen
> * Reconnection support — switch apps and come back without losing your spot
> * Equal genre distribution between players
> * Works on mobile and desktop
> * Host controls: guess mode, number of questions (10/15/20)
> * All-time session scores across rematches

## Tech stack

**Frontend:** React, Vite, deployed on Vercel  
**Backend:** Node.js, Express, Socket.IO, deployed on Railway  
**Music data:** Last.fm API  
**Audio previews:** Deezer API  
**Lyrics:** lyrics.ovh API  

## Development challenges
#### Spotify API restrictions
Originally planned to use Spotify for music playback and playlist selection.
Ran into persistent 403 errors due to Spotify's Development Mode restrictions
which block playlist track fetching. Switched to Last.fm for track metadata
and Deezer for 30-second audio previews, which are completely open and require
no user authentication.
## YouTube CORS and embedding
#### Attempted to use YouTube for music playback
Ran into CORS policy blocks when searching from the frontend and embedding restrictions on certain videos.
Abandoned in favour of Deezer previews fetched server-side.
## Mobile audio autoplay
#### Browsers block audio from playing automatically without a user interaction first.
Fixed by creating a single Audio object during a user tap in the lobby screen
and reusing it throughout the game by changing the src property, rather than
creating new Audio objects per question which would lose the mobile unlock.
## Socket.IO CORS in production
#### Local development worked fine but deploying to Railway caused CORS errors when the Vercel frontend tried to connect.
Fixed by explicitly setting the
Railway server's root directory, start command, and configuring CORS headers
to allow the Vercel domain.
## Git and deployment setup
#### First time setting up a full deployment pipeline
Learned how to push code to GitHub, 
deploy a Node.js backend to Railway with WebSocket support,
and deploy a React frontend to Vercel with automatic builds from GitHub.
## Reconnection on mobile
#### Socket.IO disconnects when players switch apps to share the room code or their phone screen turns off. 
Fixed with a 60-second grace period using disconnect timers
keyed by room code and player name rather than socket ID, so rejoining with a new
socket ID correctly cancels the old timer and restores host status. Player name
and room code are persisted in localStorage and read into refs to survive React
closure staleness on reconnect.
## Stale React closures
#### The reconnect handler kept sending empty player names because React's useEffect captures state values at mount time. 
Fixed by using useRef for player name and
room code so the connect event always reads the current value regardless of when
it fires.
## Lyrics mode quality
#### The lyrics.ovh API returns lyrics for many songs but with inconsistent quality
Filler words like "yeah", "ooh", "ahh" kept appearing as the blank word, making
questions feel random rather than fun.  
Fixed with a blacklist of common filler
words combined with a pattern detection function that rejects words made of
repeated short sequences like "lalala" or "oohoh", while preserving real words
that happen to contain those letter combinations.
## Lyrics mode loading stalls
#### In lyrics mode the game would visibly freeze between questions while the server fetched both a Deezer preview and lyrics for the next song.
Fixed by prefetching the next two questions in the background during the current
question's 30-second window, so by the time the question ends the next one is
already ready. Also the loading screen now stays on until the first question is
genuinely ready rather than firing on a fixed timer.
## Equal genre distribution
#### When multiple players picked different genres, the random shuffle meant some genres dominated while others barely appeared.
Fixed by interleaving tracks from
each player one at a time before deduplication, so questions rotate evenly
between all genres rather than being distributed by chance.
## Estonian character support
#### Songs and lyrics in Estonian contain special characters like õ, ä, ö, ü which players couldn't reliably type on mobile keyboards.
Fixed by normalizing both
the player's answer and the correct answer to their base Latin equivalents before
comparing, so "sudame" matches "südame" without penalising players for missing
diacritics.