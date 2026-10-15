const HaxballJS = require('haxball-headless-api');
const fs = require('fs');

let futsalMap = "";
try {
  futsalMap = fs.readFileSync('./futsal.hbs', 'utf8');
} catch (e) {
  console.log("Harita dosyası okunamadı, klasik harita kullanılacak.");
}

HaxballJS().then((HBInit) => {
  const room = HBInit({
    roomName: "⚽ 7/24 FUTSAL 3v3 / 4v4 [GEN, OTO-MOD & KISAYOL]",
    playerName: "Samet Host",
    maxPlayers: 12,
    public: true,
    noPlayer: false,
    token: process.env.TOKEN
  });

  if (futsalMap) {
    room.setCustomStadium(futsalMap);
  } else {
    room.setDefaultStadium("Classic");
  }

  room.setScoreLimit(3);
  room.setTimeLimit(3);

  // Botu İzleyicide Sabitleme
  room.onRoomLink = () => { room.setPlayerTeam(0, 0); };
  room.onPlayerTeamChange = (changedPlayer) => {
    if (changedPlayer.id === 0 && changedPlayer.team !== 0) {
      room.setPlayerTeam(0, 0);
    }
  };

  // Veritabanı ve Yasaklar
  let playersDB = {};       // { auth: { name, password, role, gen, wins } }
  let activeSessions = {};  // { playerId: auth }
  let mutedPlayers = {};    // { auth: bitisZamani }
  const ADMIN_AUTH = process.env.ADMIN_AUTH || "SENIN_AUTH_KODUN";

  // Yasaklı Kelimeler (Oto-Mod Küfür Filtresi -> 5 Dk Mute)
  const badWords = ["amk", "aq", "orospu", "o.ç", "sik", "anan", "piç", "sg"]; 

  room.onPlayerJoin = (player) => {
    if (player.id === 0) return;

    // Ban kontrolü veya karşılama
    room.sendChat(`👋 Hoş geldin ${player.name}!`, player.id);
    room.sendChat(`📝 Kayıt: !kayit <sifre> | 🔑 Giriş: !giris <sifre>`, player.id);

    if (player.auth === ADMIN_AUTH) {
      room.setPlayerAdmin(player.id, true);
      room.sendChat(`👑 Kurucu giriş yaptı. Yetkiler verildi!`, player.id);
    }

    updateTeams();
  };

  room.onPlayerLeave = (player) => {
    delete activeSessions[player.id];
    updateTeams();
  };

  // --- SOHBET VE OTO-MOD / KISAYOL SİSTEMİ ---
  room.onPlayerChat = (player, message) => {
    let auth = player.auth;

    // 1. Mute (Susturulmuş mu?) Kontrolü
    if (mutedPlayers[auth]) {
      if (Date.now() < mutedPlayers[auth]) {
        room.sendChat(`❌ Susturuldunuz! Konuşmak için sürenizin bitmesini bekleyin.`, player.id);
        return false; // Mesajı engelle
      } else {
        delete mutedPlayers[auth]; // Süresi dolmuşsa mute'u kaldır
      }
    }

    let lowerMsg = message.toLowerCase().trim();

    // 2. OTO-MOD KÜFÜR FİLTRESİ (Otomatik 5 Dakika Mute)
    let isBad = badWords.some(word => lowerMsg.includes(word));
    if (isBad) {
      let muteTime = Date.now() + (5 * 60 * 1000); // 5 Dakika
      mutedPlayers[auth] = muteTime;
      room.sendChat(`⚠️ Küfür/Hakaret tespit edildi! ${player.name}, 5 dakika süreyle susturuldu.`);
      return false; // Küfürlü mesajı odaya yazdırma
    }

    // 3. KISAYOLLAR (Harf Dönüşümleri)
    if (lowerMsg === "sa") {
      room.sendChat(`aleykümselam, Hoş geldin! (${player.name})`);
      return false;
    }
    if (lowerMsg === "as") {
      room.sendChat(`aleykümselam! (${player.name})`);
      return false;
    }
    if (lowerMsg === "mb") {
      room.sendChat(`Benim hatam / Sağlık olsun! (${player.name})`);
      return false;
    }
    if (lowerMsg === "np") {
      room.sendChat(`Sıkıntı yok, devam! (${player.name})`);
      return false;
    }
    if (lowerMsg === "nt") {
      room.sendChat(`Güzel denemeydi! (${player.name})`);
      return false;
    }

    // 4. KOMUTLAR
    let args = message.split(" ");
    let cmd = args[0].toLowerCase();

    // Kayıt Olma
    if (cmd === "!kayit") {
      let pass = args[1];
      if (!pass) return room.sendChat("⚠️ Kullanım: !kayit <sifre>", player.id);
      if (playersDB[auth]) return room.sendChat("❌ Bu cihaz zaten kayıtlı!", player.id);

      playersDB[auth] = { name: player.name, password: pass, role: "Oyuncu", gen: 60, wins: 0 };
      activeSessions[player.id] = auth;
      room.sendChat(`✅ Kayıt başarılı! Başlangıç GEN: 60`, player.id);
      return false;
    }

    // Giriş Yapma
    if (cmd === "!giris") {
      let pass = args[1];
      let account = playersDB[auth];
      if (!account) return room.sendChat("❌ Kayıtlı hesabınız yok. !kayit <sifre> yazın.", player.id);
      if (account.password !== pass) return room.sendChat("❌ Yanlış şifre!", player.id);

      activeSessions[player.id] = auth;
      room.sendChat(`🔓 Giriş yapıldı! Rol: [${account.role}] | GEN: ${account.gen}`, player.id);
      if (account.role === "Admin" || account.role === "Mod") {
        room.setPlayerAdmin(player.id, true);
      }
      return false;
    }

    // İstatistikler
    if (cmd === "!stats" || cmd === "!gen") {
      let acc = playersDB[auth];
      if (!acc) return room.sendChat("❌ Önce giriş yapmalısınız (!giris <sifre>).", player.id);
      room.sendChat(`📊 [${acc.name}] GEN: ${acc.gen} | Galibiyet: ${acc.wins} | Rol: ${acc.role}`, player.id);
      return false;
    }

    // --- YETKİLİ KOMUTLARI (Mute, Ban, Rol) ---
    if (cmd === "!mute") {
      if (!player.admin) return room.sendChat("❌ Bu komutu sadece adminler kullanabilir.", player.id);
      let targetId = parseInt(args[1]);
      let target = room.getPlayer(targetId);
      if (target) {
        mutedPlayers[target.auth] = Date.now() + (5 * 60 * 1000); // 5 dk mute
        room.sendChat(`🔇 ${target.name} oyuncusu 5 dakika süreyle susturuldu.`);
      }
      return false;
    }

    if (cmd === "!unmute") {
      if (!player.admin) return room.sendChat("❌ Yetkiniz yok.", player.id);
      let targetId = parseInt(args[1]);
      let target = room.getPlayer(targetId);
      if (target && mutedPlayers[target.auth]) {
        delete mutedPlayers[target.auth];
        room.sendChat(`🔊 ${target.name} oyuncusunun susturması kaldırıldı.`);
      }
      return false;
    }

    if (cmd === "!ban") {
      if (!player.admin) return room.sendChat("❌ Yetkiniz yok.", player.id);
      let targetId = parseInt(args[1]);
      let target = room.getPlayer(targetId);
      if (target) {
        room.kickPlayer(target.id, "Sunucudan yasaklandınız!", true); // true = ban
        room.sendChat(`🔨 ${target.name} odadan yasaklandı.`);
      }
      return false;
    }

    if (cmd === "!rolver") {
      if (!player.admin) return room.sendChat("❌ Yetkiniz yok.", player.id);
      let targetId = parseInt(args[1]);
      let newRole = args[2]; // Admin veya Mod
      let target = room.getPlayer(targetId);
      if (target && activeSessions[target.id]) {
        playersDB[activeSessions[target.id]].role = newRole;
        if (newRole === "Admin" || newRole === "Mod") room.setPlayerAdmin(target.id, true);
        room.sendChat(`⭐ ${target.name} oyuncusunun yeni rolü: ${newRole}`);
      }
      return false;
    }
  };

  // --- OTOMATİK FUTSAL TAKIM DAĞITIMI ---
  function updateTeams() {
    let players = room.getPlayerList().filter(p => p.id !== 0);
    let redCount = players.filter(p => p.team === 1).length;
    let blueCount = players.filter(p => p.team === 2).length;

    players.forEach(p => {
      if (p.team === 0) {
        if (redCount <= blueCount && redCount < 4) {
          room.setPlayerTeam(p.id, 1);
          redCount++;
        } else if (blueCount < 4) {
          room.setPlayerTeam(p.id, 2);
          blueCount++;
        }
      }
    });
  }

  // Maç Sonu Kazanana GEN Artışı
  room.onGameEnd = (winningTeam) => {
    room.sendChat("🏁 Maç Bitti! Kazananlara +2 GEN eklendi.");
    let players = room.getPlayerList().filter(p => p.team === winningTeam);
    players.forEach(p => {
      let auth = activeSessions[p.id];
      if (auth && playersDB[auth]) {
        playersDB[auth].gen += 2;
        playersDB[auth].wins += 1;
      }
    });
    setTimeout(() => { room.startGame(); }, 5000);
  };
});
