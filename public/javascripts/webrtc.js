(() => {
  window.addEventListener("load", () => {
    const previewButton = document.getElementById("preview-button");
    const joinChannelButton = document.getElementById("join-channel-button");
    const leaveChannelButton = document.getElementById("leave-channel-button");
    const micToggleBtn = document.getElementById("mic-toggle-btn");
    const camToggleBtn = document.getElementById("cam-toggle-btn");
    const mainStageVideo = document.getElementById("main-stage-video");
    const mainStageAudio = document.getElementById("main-stage-audio");
    const stageUserTitle = document.getElementById("stage-user-title");
    const stageCountPill = document.getElementById("stage-count-pill");
    const thumbsGallery = document.getElementById("rtc-thumbs-gallery");
    const audioSink = document.getElementById("rtc-audio-sink");
    const audioCheckbox = document.getElementById("audio-checkbox");
    const videoCheckbox = document.getElementById("video-checkbox");
    const incomingCallModal = document.getElementById("incoming-call-modal");
    const incomingCallerName = document.getElementById("incoming-caller-name");
    const mainStage = document.getElementById("rtc-main-stage");
    const floatingControls = document.getElementById("rtc-floating-controls");

    if (!joinChannelButton) return;

    let controlsAutoHideTimer = null;

    function resetControlsAutoHide() {
      if (!floatingControls) return;
      floatingControls.classList.remove("auto-hidden");
      if (controlsAutoHideTimer) {
        clearTimeout(controlsAutoHideTimer);
        controlsAutoHideTimer = null;
      }
      // 移动端 (<= 768px) 在通话或有媒体流时，4秒无操作自动轻量淡出，杜绝遮挡画面
      if (window.innerWidth <= 768 && (inChannel || localStream || isDirectCallingWait)) {
        controlsAutoHideTimer = setTimeout(() => {
          if (inChannel || localStream || isDirectCallingWait) {
            floatingControls.classList.add("auto-hidden");
          }
        }, 4000);
      }
    }

    if (mainStage) {
      mainStage.addEventListener("click", (e) => {
        // 若点击的是控制栏内的按钮，重置倒计时即可
        if (floatingControls && floatingControls.contains(e.target)) {
          resetControlsAutoHide();
          return;
        }
        // 若点击的是角落退出关闭按钮不干涉
        if (e.target.closest(".btn-rtc-corner-close")) return;

        // 点击大屏任意空白处：轻触切换显示/隐藏控制栏
        if (floatingControls) {
          if (floatingControls.classList.contains("auto-hidden")) {
            resetControlsAutoHide();
          } else {
            floatingControls.classList.add("auto-hidden");
            if (controlsAutoHideTimer) {
              clearTimeout(controlsAutoHideTimer);
              controlsAutoHideTimer = null;
            }
          }
        }
      });
    }

    let localStream = null;
    let inChannel = false;
    let channelUsers = new Set();
    let isMicEnabled = true;
    let isCamEnabled = true;

    // 通话模式: "idle" | "direct" (一对一专属通话) | "group" (群体聊天室会议)
    let callMode = "idle";
    let currentDirectPeer = null;
    let pendingIncomingCall = null;
    let isDirectCallingWait = false;
    let directCallTimeoutTimer = null;
    let outgoingRingAudioContext = null;
    let outgoingRingInterval = null;
    let currentRoomId = "default";
    let currentRoomName = "群聊会议室";
    let ringInterval = null;
    let ringAudioContext = null;

    // 存储与各远端用户的 RTCPeerConnection: targetId -> RTCPeerConnection
    let peerConnections = {};
    // 存储各远端用户的 MediaStream: targetId -> MediaStream
    let remoteStreams = {};

    // 当前主大屏展示的用户 ID (默认是自己 localID)
    let focusedUserId = null;

    // Google 公网 STUN 服务器配置
    const rtcConfig = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
      ],
    };

    // 麦克风开关控制
    function setMicState(enabled) {
      isMicEnabled = enabled;
      if (micToggleBtn) {
        if (enabled) {
          micToggleBtn.classList.add("active");
          micToggleBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
          micToggleBtn.title = "静音麦克风";
        } else {
          micToggleBtn.classList.remove("active");
          micToggleBtn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
          micToggleBtn.title = "开启麦克风";
        }
      }
      if (audioCheckbox) audioCheckbox.checked = enabled;
      if (localStream) {
        localStream.getAudioTracks().forEach((t) => (t.enabled = enabled));
      }
      renderMultiStage();
    }

    if (micToggleBtn) {
      micToggleBtn.onclick = () => setMicState(!isMicEnabled);
    }

    // 摄像头开关控制 (开摄像头显示视频，关摄像头显示呼吸动效音频头像)
    function setCamState(enabled) {
      isCamEnabled = enabled;
      if (camToggleBtn) {
        if (enabled) {
          camToggleBtn.classList.add("active");
          camToggleBtn.innerHTML = '<i class="fa-solid fa-video"></i>';
          camToggleBtn.title = "关闭摄像头 (切为语音模式)";
        } else {
          camToggleBtn.classList.remove("active");
          camToggleBtn.innerHTML = '<i class="fa-solid fa-video-slash"></i>';
          camToggleBtn.title = "开启摄像头 (切为视频模式)";
        }
      }
      if (videoCheckbox) videoCheckbox.checked = enabled;
      if (localStream) {
        localStream.getVideoTracks().forEach((t) => (t.enabled = enabled));
      }
      renderMultiStage();
    }

    if (camToggleBtn) {
      camToggleBtn.onclick = () => setCamState(!isCamEnabled);
    }

    // 兼容 checkbox
    if (audioCheckbox) {
      audioCheckbox.addEventListener("change", function () {
        setMicState(this.checked);
      });
    }
    if (videoCheckbox) {
      videoCheckbox.addEventListener("change", function () {
        setCamState(this.checked);
      });
    }

    // 彻底停止并释放本地麦克风与摄像头硬件资源 (防止后台持续占用麦克风)
    function releaseLocalMedia() {
      if (localStream) {
        try {
          localStream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch (errTrack) {
              console.warn("停止音视频轨道异常:", errTrack);
            }
          });
        } catch (errStream) {
          console.warn("释放本地媒体流失败:", errStream);
        }
        localStream = null;
      }

      if (virtualInterval) {
        clearInterval(virtualInterval);
        virtualInterval = null;
      }
      virtualCanvas = null;

      if (silentAudioCtx && silentAudioCtx.state !== "closed") {
        try {
          silentAudioCtx.close();
        } catch (e) {}
        silentAudioCtx = null;
      }

      if (mainStageVideo) {
        mainStageVideo.srcObject = null;
      }

      if (previewButton) {
        previewButton.classList.remove("active");
        previewButton.title = "开启设备预览";
      }
    }

    // 预览摄像头与麦克风设备 (支持切换开启/关闭并彻底释放硬件)
    if (previewButton) {
      previewButton.onclick = async () => {
        if (inChannel) {
          showAlert("当前正在通话中", "info");
          return;
        }
        if (localStream) {
          // 再次点击 -> 退出预览并彻底释放麦克风与摄像头
          releaseLocalMedia();
          renderMultiStage();
          showAlert("已停止设备预览并释放麦克风", "info");
        } else {
          // 点击开启 -> 初始化预览设备
          const success = await initLocalMedia();
          if (success) {
            previewButton.classList.add("active");
            previewButton.title = "关闭设备预览 (释放麦克风)";
            renderMultiStage();
            showAlert("已开启设备预览", "info");
          }
        }
      };
    }

    // 动态创建虚拟黑屏视视频流 (当本地无物理摄像头时平滑接管)
    let virtualCanvas = null;
    let virtualInterval = null;

    function createBlackScreenStream(userName) {
      if (!virtualCanvas) {
        virtualCanvas = document.createElement("canvas");
        virtualCanvas.width = 640;
        virtualCanvas.height = 480;
      }
      const ctx = virtualCanvas.getContext("2d");

      function draw() {
        // 1. 深黑色背景
        ctx.fillStyle = "#020408";
        ctx.fillRect(0, 0, 640, 480);

        // 2. 居中视窗柔和微光渐变
        const grad = ctx.createRadialGradient(320, 220, 30, 320, 220, 320);
        grad.addColorStop(0, "#0f172a");
        grad.addColorStop(1, "#020408");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 640, 480);

        // 3. 用户头像圆形外框 (上移避开底部控制栏)
        ctx.fillStyle = "rgba(30, 41, 59, 0.5)";
        ctx.beginPath();
        ctx.arc(320, 145, 52, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(59, 130, 246, 0.4)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(320, 145, 52, 0, Math.PI * 2);
        ctx.stroke();

        // 4. 用户剪影图标
        ctx.fillStyle = "#38bdf8";
        ctx.beginPath();
        ctx.arc(320, 132, 18, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(320, 175, 28, Math.PI, Math.PI * 2);
        ctx.fill();

        // 5. 标注用户名字 (大号字显眼，上移避开控制栏)
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(userName || "本地 (我)", 320, 222);

        // 6. 标注状态说明
        ctx.fillStyle = "rgba(148, 163, 184, 0.85)";
        ctx.font = "13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText("● 黑屏视讯模式 (免摄像头限制)", 320, 252);
      }

      draw();
      if (!virtualInterval) {
        virtualInterval = setInterval(draw, 1000);
      }

      return virtualCanvas.captureStream(10);
    }

    // 动态创建静音虚拟音频轨道 (当本地无麦克风时使用)
    let silentAudioCtx = null;

    function createSilentAudioTrack() {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;
        if (silentAudioCtx && silentAudioCtx.state !== "closed") {
          try {
            silentAudioCtx.close();
          } catch (e) {}
        }
        silentAudioCtx = new AudioContextClass();
        const osc = silentAudioCtx.createOscillator();
        const dst = silentAudioCtx.createMediaStreamDestination();
        const gain = silentAudioCtx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(dst);
        osc.start();
        return dst.stream.getAudioTracks()[0];
      } catch (e) {
        console.warn("无法创建静音音频轨道:", e);
        return null;
      }
    }

    // 初始化本地视音频流 (彻底消除摄像头与麦克风硬件限制)
    async function initLocalMedia() {
      if (localStream) return true;

      const userName = (typeof localID !== "undefined" && localID)
        ? (localID.length > 8 ? localID.substring(0, 8) + "... (我)" : localID + " (我)")
        : "本地 (我)";

      let realStream = null;
      let hasRealVideo = false;
      let hasRealAudio = false;

      // 1. 探测真实硬件
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          realStream = await navigator.mediaDevices.getUserMedia({
            audio: isMicEnabled,
            video: isCamEnabled,
          });
          hasRealVideo = realStream.getVideoTracks().length > 0;
          hasRealAudio = realStream.getAudioTracks().length > 0;
        } catch (errVideo) {
          console.warn("未检测到摄像头硬件或权限被拒，尝试仅麦克风:", errVideo);
          try {
            realStream = await navigator.mediaDevices.getUserMedia({
              audio: isMicEnabled,
              video: false,
            });
            hasRealAudio = realStream.getAudioTracks().length > 0;
          } catch (errAudio) {
            console.warn("未检测到麦克风硬件，进入免硬件全虚拟模式:", errAudio);
          }
        }
      }

      const tracks = [];

      // 2. 音频轨道
      if (hasRealAudio && realStream) {
        tracks.push(realStream.getAudioTracks()[0]);
      } else {
        const silentAudio = createSilentAudioTrack();
        if (silentAudio) tracks.push(silentAudio);
      }

      // 3. 视频轨道 (真实摄像头 或 黑屏虚拟视频)
      if (hasRealVideo && realStream) {
        tracks.push(realStream.getVideoTracks()[0]);
      } else {
        const blackStream = createBlackScreenStream(userName);
        if (blackStream && blackStream.getVideoTracks().length > 0) {
          tracks.push(blackStream.getVideoTracks()[0]);
        }
      }

      localStream = new MediaStream(tracks);
      if (!focusedUserId) focusedUserId = localID;

      // 为已有 PeerConnection 装载新轨道
      for (let peerId in peerConnections) {
        const pc = peerConnections[peerId];
        tracks.forEach((t) => pc.addTrack(t, localStream));
      }

      renderMultiStage();

      if (!hasRealVideo) {
        showAlert("已启用黑屏视讯（无摄像头硬件限制）", "info");
      } else {
        showAlert("本地视音频设备已就绪", "success");
      }
      return true;
    }

    // 柔和优雅的来电提示音效 (Web Audio API)
    function startRingtone() {
      try {
        if (!ringAudioContext) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            ringAudioContext = new AudioContextClass();
          }
        }
        if (!ringAudioContext) return;
        if (ringAudioContext.state === "suspended") {
          ringAudioContext.resume();
        }

        const playChime = () => {
          if (!ringAudioContext) return;
          const osc1 = ringAudioContext.createOscillator();
          const osc2 = ringAudioContext.createOscillator();
          const gainNode = ringAudioContext.createGain();

          osc1.type = "sine";
          osc1.frequency.setValueAtTime(440, ringAudioContext.currentTime); // A4
          osc2.type = "sine";
          osc2.frequency.setValueAtTime(554.37, ringAudioContext.currentTime); // C#5

          gainNode.gain.setValueAtTime(0.08, ringAudioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.001, ringAudioContext.currentTime + 0.6);

          osc1.connect(gainNode);
          osc2.connect(gainNode);
          gainNode.connect(ringAudioContext.destination);

          osc1.start();
          osc2.start();
          osc1.stop(ringAudioContext.currentTime + 0.6);
          osc2.stop(ringAudioContext.currentTime + 0.6);
        };

        playChime();
        if (ringInterval) clearInterval(ringInterval);
        ringInterval = setInterval(playChime, 2000);
      } catch (err) {
        console.warn("无法播放来电提示音:", err);
      }
    }

    function stopRingtone() {
      if (ringInterval) {
        clearInterval(ringInterval);
        ringInterval = null;
      }
      if (ringAudioContext && ringAudioContext.state !== "closed") {
        try {
          ringAudioContext.close();
        } catch (e) {}
        ringAudioContext = null;
      }
    }

    // 呼叫中外呼回铃提示音 (Web Audio API 模拟电话嘟...嘟...嘟...)
    function startOutgoingRing() {
      try {
        if (!outgoingRingAudioContext) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            outgoingRingAudioContext = new AudioContextClass();
          }
        }
        if (!outgoingRingAudioContext) return;
        if (outgoingRingAudioContext.state === "suspended") {
          outgoingRingAudioContext.resume();
        }

        const playRingback = () => {
          if (!outgoingRingAudioContext || !isDirectCallingWait) return;
          const osc = outgoingRingAudioContext.createOscillator();
          const gainNode = outgoingRingAudioContext.createGain();

          osc.type = "sine";
          osc.frequency.setValueAtTime(450, outgoingRingAudioContext.currentTime);

          gainNode.gain.setValueAtTime(0.06, outgoingRingAudioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.001, outgoingRingAudioContext.currentTime + 0.9);

          osc.connect(gainNode);
          gainNode.connect(outgoingRingAudioContext.destination);

          osc.start();
          osc.stop(outgoingRingAudioContext.currentTime + 0.9);
        };

        playRingback();
        if (outgoingRingInterval) clearInterval(outgoingRingInterval);
        outgoingRingInterval = setInterval(playRingback, 3000);
      } catch (err) {
        console.warn("无法播放外呼提示音:", err);
      }
    }

    function stopOutgoingRing() {
      if (outgoingRingInterval) {
        clearInterval(outgoingRingInterval);
        outgoingRingInterval = null;
      }
      if (outgoingRingAudioContext && outgoingRingAudioContext.state !== "closed") {
        try {
          outgoingRingAudioContext.close();
        } catch (e) {}
        outgoingRingAudioContext = null;
      }
    }

    // 加入群体公共会议室核心逻辑
    async function handleJoinChannel() {
      if (inChannel && callMode === "group") {
        return true;
      }

      // 关键防呆：必须有明确的群聊房间（由新建或卡片进入），禁止无房间自建单人幽灵频道（自己跟自己打电话）
      if (!currentRoomId || currentRoomId === "default") {
        if (typeof openCallLaunchpad === "function") {
          openCallLaunchpad();
        } else {
          showAlert("请通过【视讯通话】选择好友或新建聊天室！", "warning");
        }
        return false;
      }

      // 若当前在其他通话中，先行平滑重置
      if (inChannel) {
        handleLeaveChannel(false);
      }

      callMode = "group";
      currentDirectPeer = null;

      if (!localStream) {
        let success = await initLocalMedia();
        if (!success) return false;
      }

      inChannel = true;
      channelUsers.clear();
      channelUsers.add(localID);
      if (!focusedUserId) focusedUserId = localID;

      joinChannelButton.classList.add("hidden");
      if (leaveChannelButton) {
        leaveChannelButton.classList.remove("hidden");
        leaveChannelButton.disabled = false;
        leaveChannelButton.title = "挂断离开群聊频道";
      }

      // 确保视频房间已展开可见
      if (typeof toggleRtcPanel === "function") {
        toggleRtcPanel(true);
      }

      // 向所有在线客户端广播加入群聊多人频道
      sendRtcSignal({
        type: "joinChannel",
        userId: localID,
        roomId: currentRoomId,
        roomName: currentRoomName,
      });

      showAlert(`已进入群视频【${currentRoomName}】`, "success");
      renderMultiStage();
      return true;
    }

    // 新建群聊音视频房间并向公屏广播邀请卡片
    window.createGroupRoom = async function (roomName) {
      const name = (roomName && roomName.trim()) ? roomName.trim() : "群聊多人会议";
      const roomId = "room_" + Math.random().toString(36).substring(2, 9);

      if (inChannel) {
        handleLeaveChannel(false);
      }

      currentRoomId = roomId;
      currentRoomName = name;

      // 广播给 Socket 服务器生成公屏卡片
      if (typeof socket !== "undefined" && socket) {
        socket.emit("create-group-room", {
          roomId: currentRoomId,
          roomName: currentRoomName,
        });
      }

      await handleJoinChannel();
    };

    // 加入指定群聊音视频房间 (点击公屏卡片或按钮)
    window.joinGroupRoom = async function (roomId, roomName) {
      if (inChannel && callMode === "group" && currentRoomId === roomId) {
        showAlert("您已在当前群视频房间中", "info");
        return;
      }

      // 请求服务器鉴权加入：验证房间是否存在且至少有1人在内
      if (typeof socket !== "undefined" && socket) {
        socket.emit("join-group-room", { roomId: roomId }, async (res) => {
          if (res && !res.success) {
            showAlert(res.message || "该聊天室已无人，已自动解散！", "warning");
            if (typeof markCardAsClosedById === "function") {
              markCardAsClosedById(roomId);
            }
            return;
          }
          if (inChannel) {
            handleLeaveChannel(false);
          }
          currentRoomId = roomId || "default";
          currentRoomName = roomName || "群聊会议室";
          await handleJoinChannel();
        });
      } else {
        if (inChannel) {
          handleLeaveChannel(false);
        }
        currentRoomId = roomId || "default";
        currentRoomName = roomName || "群聊会议室";
        await handleJoinChannel();
      }
    };

    if (joinChannelButton) {
      joinChannelButton.onclick = () => {
        if (typeof openCallLaunchpad === "function") {
          openCallLaunchpad();
        } else {
          showAlert("请选择在线好友呼叫或新建聊天室！", "info");
        }
      };
    }

    // 退出通话 (群聊离开 或 一对一挂断)
    if (leaveChannelButton) {
      leaveChannelButton.onclick = () => {
        handleLeaveChannel(true);
      };
    }

    function handleLeaveChannel(showAlertMsg = true) {
      const wasActive = inChannel || !!localStream || isDirectCallingWait;
      if (!wasActive) {
        if (typeof toggleRtcPanel === "function") {
          toggleRtcPanel(false);
        }
        return;
      }

      stopRingtone();
      stopOutgoingRing();
      if (directCallTimeoutTimer) {
        clearTimeout(directCallTimeoutTimer);
        directCallTimeoutTimer = null;
      }
      isDirectCallingWait = false;
      const overlay = document.getElementById("rtc-calling-overlay");
      if (overlay) overlay.classList.add("hidden");
      if (incomingCallModal) incomingCallModal.classList.add("hidden");

      if (callMode === "direct" && currentDirectPeer) {
        sendRtcSignal({
          type: "directCallCancel",
          targetId: currentDirectPeer,
        });
      } else if (callMode === "group") {
        if (typeof socket !== "undefined" && socket) {
          socket.emit("leave-group-room", {
            roomId: currentRoomId,
          });
        }
        sendRtcSignal({
          type: "leaveChannel",
          userId: localID,
          roomId: currentRoomId,
        });
      }

      inChannel = false;
      callMode = "idle";
      currentDirectPeer = null;
      currentRoomId = "default";
      currentRoomName = "群聊会议室";
      channelUsers.clear();

      for (let peerId in peerConnections) {
        closePeerConnection(peerId);
      }

      peerConnections = {};
      remoteStreams = {};
      focusedUserId = localID;

      // 彻底停止并释放本地麦克风与摄像头硬件资源
      releaseLocalMedia();

      // 核心修复：挂断或退出通话时，自动收起并隐藏音视频抽屉，杜绝在顶端遗留“本地 (我)”
      if (typeof toggleRtcPanel === "function") {
        toggleRtcPanel(false);
      }

      // 隐藏加入与挂断按钮，杜绝退出后点击残留绿色电话导致“自己打给自己”
      if (joinChannelButton) {
        joinChannelButton.classList.add("hidden");
      }
      if (leaveChannelButton) {
        leaveChannelButton.classList.add("hidden");
      }

      if (controlsAutoHideTimer) {
        clearTimeout(controlsAutoHideTimer);
        controlsAutoHideTimer = null;
      }
      if (floatingControls) {
        floatingControls.classList.remove("auto-hidden");
      }

      syncAudioSink();
      renderMultiStage();
      if (showAlertMsg) {
        showAlert("已退出音视频通话，麦克风已释放", "warning");
      }
    }

    // 主叫方主动取消呼叫
    window.cancelDirectCall = function () {
      stopOutgoingRing();
      if (directCallTimeoutTimer) {
        clearTimeout(directCallTimeoutTimer);
        directCallTimeoutTimer = null;
      }
      isDirectCallingWait = false;
      const overlay = document.getElementById("rtc-calling-overlay");
      if (overlay) overlay.classList.add("hidden");

      if (currentDirectPeer) {
        sendRtcSignal({
          type: "directCallCancel",
          targetId: currentDirectPeer,
        });
      }
      handleLeaveChannel(false);
      showAlert("已取消呼叫", "info");
    };

    // 发起一对一专属呼叫
    window.startDirectCall = async function (targetId) {
      const myId = (typeof localID !== "undefined" && localID) || (typeof socket !== "undefined" && socket && socket.id);
      if (!targetId || targetId === myId || targetId === localID) {
        showAlert("无法呼叫自己！", "warning");
        return;
      }

      if (inChannel) {
        handleLeaveChannel(false);
      }

      callMode = "direct";
      currentDirectPeer = targetId;
      isDirectCallingWait = true;

      if (typeof toggleRtcPanel === "function") {
        toggleRtcPanel(true);
      }

      if (!localStream) {
        let success = await initLocalMedia();
        if (!success) {
          isDirectCallingWait = false;
          return;
        }
      }

      inChannel = true;
      channelUsers.clear();
      channelUsers.add(localID);
      // 关键保护：对方接听前绝对不加进 channelUsers，否则会提前显示在画面中像已经接听一样！
      focusedUserId = localID;

      // 展现呼叫遮罩与等待状态
      const overlay = document.getElementById("rtc-calling-overlay");
      const statusText = document.getElementById("calling-status-text");
      if (statusText) {
        statusText.innerText = `正在呼叫 ${targetId.substring(0, 8)}...`;
      }
      if (overlay) {
        overlay.classList.remove("hidden");
      }

      joinChannelButton.classList.add("hidden");
      if (leaveChannelButton) {
        leaveChannelButton.classList.remove("hidden");
        leaveChannelButton.disabled = false;
        leaveChannelButton.title = "取消呼叫";
      }

      // 启动拨号回铃声和 45 秒超时自动挂断
      startOutgoingRing();
      if (directCallTimeoutTimer) clearTimeout(directCallTimeoutTimer);
      directCallTimeoutTimer = setTimeout(() => {
        if (isDirectCallingWait) {
          showAlert("对方无人接听", "warning");
          window.cancelDirectCall();
        }
      }, 45000);

      // 发送定向来电邀请
      sendRtcSignal({
        type: "directCallInvite",
        targetId: targetId,
        callerId: localID,
        callerName: localID ? localID.substring(0, 8) : "好友"
      });

      showAlert(`正在呼叫 ${targetId.substring(0, 8)}... 等待对方接听`, "info");
      renderMultiStage();
    };

    // 被叫方接听一对一通话
    window.acceptDirectCall = async function () {
      stopRingtone();
      if (incomingCallModal) incomingCallModal.classList.add("hidden");

      if (!pendingIncomingCall) return;
      const callerId = pendingIncomingCall.callerId;
      pendingIncomingCall = null;

      if (inChannel) {
        handleLeaveChannel(false);
      }

      callMode = "direct";
      currentDirectPeer = callerId;
      isDirectCallingWait = false;

      const overlay = document.getElementById("rtc-calling-overlay");
      if (overlay) overlay.classList.add("hidden");

      if (typeof toggleRtcPanel === "function") {
        toggleRtcPanel(true);
      }

      if (!localStream) {
        let success = await initLocalMedia();
        if (!success) return;
      }

      inChannel = true;
      channelUsers.clear();
      channelUsers.add(localID);
      channelUsers.add(callerId);
      focusedUserId = callerId;

      joinChannelButton.classList.add("hidden");
      if (leaveChannelButton) {
        leaveChannelButton.classList.remove("hidden");
        leaveChannelButton.disabled = false;
        leaveChannelButton.title = "挂断通话";
      }

      sendRtcSignal({
        type: "directCallAccept",
        targetId: callerId,
        userId: localID,
      });

      showAlert(`已接听来自 ${callerId.substring(0, 8)}... 的通话`, "success");
      renderMultiStage();
    };

    // 被叫方拒绝一对一通话
    window.rejectDirectCall = function () {
      stopRingtone();
      if (incomingCallModal) incomingCallModal.classList.add("hidden");

      if (!pendingIncomingCall) return;
      const callerId = pendingIncomingCall.callerId;
      pendingIncomingCall = null;

      sendRtcSignal({
        type: "directCallReject",
        targetId: callerId,
        reason: "declined"
      });
      showAlert("已拒绝通话", "info");
    };

    // 通过 Socket.IO 转发 WebRTC 信令
    function sendRtcSignal(data) {
      if (typeof socket !== "undefined" && socket) {
        socket.emit("rtc-signal", data);
      }
    }

    // 绑定 Socket.IO 信令事件处理
    function initSocketListeners() {
      if (typeof socket === "undefined" || !socket) {
        setTimeout(initSocketListeners, 500);
        return;
      }

      socket.on("rtc-signal", async (data) => {
        const senderId = data.senderId;
        const myId = (typeof localID !== "undefined" && localID) || (typeof socket !== "undefined" && socket && socket.id);
        if (senderId === myId || senderId === localID) return;

        switch (data.type) {
          case "directCallInvite": {
            // 如果已经在通话中，自动告知忙碌
            if (inChannel) {
              sendRtcSignal({
                type: "directCallReject",
                targetId: senderId,
                reason: "busy"
              });
              return;
            }

            pendingIncomingCall = {
              callerId: senderId,
              callerName: data.callerName || senderId.substring(0, 8)
            };

            if (incomingCallModal) {
              if (incomingCallerName) {
                incomingCallerName.innerText = `用户 ${pendingIncomingCall.callerName} 邀请你进行通话`;
              }
              incomingCallModal.classList.remove("hidden");
              startRingtone();
            }
            break;
          }

          case "directCallAccept": {
            stopOutgoingRing();
            if (directCallTimeoutTimer) {
              clearTimeout(directCallTimeoutTimer);
              directCallTimeoutTimer = null;
            }
            isDirectCallingWait = false;
            const overlay = document.getElementById("rtc-calling-overlay");
            if (overlay) overlay.classList.add("hidden");

            showAlert(`用户 ${senderId.substring(0, 8)}... 已接听`, "success");
            if (callMode === "direct" && currentDirectPeer === senderId) {
              channelUsers.add(senderId);
              focusedUserId = senderId;
              if (leaveChannelButton) {
                leaveChannelButton.title = "挂断通话";
              }
              try {
                const pc = createPeerConnection(senderId);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                sendRtcSignal({
                  type: "offer",
                  targetId: senderId,
                  sdp: offer
                });
              } catch (err) {
                console.error("创建 Offer 失败:", err);
              }
            }
            renderMultiStage();
            break;
          }

          case "directCallReject": {
            stopOutgoingRing();
            stopRingtone();
            if (directCallTimeoutTimer) {
              clearTimeout(directCallTimeoutTimer);
              directCallTimeoutTimer = null;
            }
            isDirectCallingWait = false;
            const overlay = document.getElementById("rtc-calling-overlay");
            if (overlay) overlay.classList.add("hidden");

            const msg = data.reason === "busy"
              ? `用户 ${senderId.substring(0, 8)}... 正在通话中`
              : `用户 ${senderId.substring(0, 8)}... 已拒绝通话`;
            showAlert(msg, "warning");
            if (callMode === "direct" && currentDirectPeer === senderId) {
              handleLeaveChannel(false);
            }
            break;
          }

          case "directCallCancel": {
            stopOutgoingRing();
            stopRingtone();
            if (directCallTimeoutTimer) {
              clearTimeout(directCallTimeoutTimer);
              directCallTimeoutTimer = null;
            }
            isDirectCallingWait = false;
            const overlay = document.getElementById("rtc-calling-overlay");
            if (overlay) overlay.classList.add("hidden");

            if (incomingCallModal) incomingCallModal.classList.add("hidden");
            if (pendingIncomingCall && pendingIncomingCall.callerId === senderId) {
              pendingIncomingCall = null;
              showAlert(`用户 ${senderId.substring(0, 8)}... 已取消呼叫`, "info");
            }
            if (callMode === "direct" && currentDirectPeer === senderId) {
              showAlert(`对方已挂断通话`, "warning");
              handleLeaveChannel(false);
            }
            break;
          }

          case "joinChannel": {
            if (data.roomId && currentRoomId && data.roomId !== currentRoomId) {
              return;
            }
            if (callMode === "group") {
              channelUsers.add(data.userId);
              if (inChannel && data.userId !== localID) {
                // 自动发起 P2P 连接呼叫
                if (!peerConnections[data.userId]) {
                  window.callPeer(data.userId);
                }
              }
              renderMultiStage();
              showAlert(`成员 ${data.userId.substring(0, 6)}... 加入了群聊`, "info");
            }
            break;
          }

          case "leaveChannel": {
            if (data.roomId && currentRoomId && data.roomId !== currentRoomId) {
              return;
            }
            channelUsers.delete(data.userId);
            closePeerConnection(data.userId);
            if (focusedUserId === data.userId) {
              focusedUserId = localID;
            }
            syncAudioSink();
            renderMultiStage();
            showAlert(`成员 ${data.userId.substring(0, 6)}... 退出了群聊`, "warning");
            break;
          }

          case "offer": {
            await handleReceiveOffer(senderId, data.sdp);
            break;
          }

          case "answer": {
            if (!inChannel) return;
            await handleReceiveAnswer(senderId, data.sdp);
            break;
          }

          case "candidate": {
            if (!inChannel) return;
            await handleReceiveCandidate(senderId, data.candidate);
            break;
          }
        }
      });

      socket.on("group-room-closed", (data) => {
        if (!data || !data.roomId) return;
        if (callMode === "group" && currentRoomId === data.roomId) {
          showAlert(`群聊天室【${data.roomName || "群聊会议室"}】所有成员已离开，已自动解散！`, "warning");
          handleLeaveChannel(false);
        }
      });

      socket.on("join-group-room-result", (res) => {
        if (res && !res.success) {
          showAlert(res.message || "该聊天室已无人，已自动解散！", "warning");
          if (typeof markCardAsClosedById === "function") {
            markCardAsClosedById(res.roomId);
          }
        }
      });
    }

    initSocketListeners();

    // 主动呼叫某位频道成员 (创建 Offer，若未入频道则自动初始化黑屏并进入)
    window.callPeer = async function (targetId) {
      const myId = (typeof localID !== "undefined" && localID) || (typeof socket !== "undefined" && socket && socket.id);
      if (!targetId || targetId === myId || targetId === localID) {
        showAlert("无法呼叫自己！", "warning");
        return;
      }

      // 确保视频房间已展开
      if (typeof toggleRtcPanel === "function") {
        toggleRtcPanel(true);
      }

      if (!inChannel) {
        let success = await handleJoinChannel();
        if (!success) return;
      }

      try {
        const pc = createPeerConnection(targetId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        sendRtcSignal({
          type: "offer",
          targetId: targetId,
          sdp: offer,
        });
        showAlert(`正在呼叫 ${targetId.substring(0, 6)}...`, "info");
      } catch (err) {
        console.error("创建 Offer 失败:", err);
      }
    };

    // 收到 Offer，响应 Answer
    async function handleReceiveOffer(senderId, offerSdp) {
      try {
        if (!inChannel) {
          console.warn("未进入音视频通话，拒绝处理未授权 Offer:", senderId);
          return;
        }
        if (callMode === "direct" && currentDirectPeer !== senderId) {
          console.warn("非当前一对一通话对象，拒绝处理 Offer:", senderId);
          return;
        }
        const pc = createPeerConnection(senderId);
        await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        sendRtcSignal({
          type: "answer",
          targetId: senderId,
          sdp: answer,
        });
      } catch (err) {
        console.error("处理 Offer 异常:", err);
      }
    }

    // 收到 Answer
    async function handleReceiveAnswer(senderId, answerSdp) {
      const pc = peerConnections[senderId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
        } catch (err) {
          console.error("设置 RemoteDescription 异常:", err);
        }
      }
    }

    // 收到 Candidate
    async function handleReceiveCandidate(senderId, candidateData) {
      const pc = peerConnections[senderId];
      if (pc && candidateData) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidateData));
        } catch (e) {
          console.error("添加 ICE Candidate 异常:", e);
        }
      }
    }

    // 创建核心 RTCPeerConnection 实例
    function createPeerConnection(peerId) {
      if (peerConnections[peerId]) {
        return peerConnections[peerId];
      }

      const pc = new RTCPeerConnection(rtcConfig);
      peerConnections[peerId] = pc;

      // 绑定本地音视频轨道
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });
      }

      // 监听 ICE 候选者
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendRtcSignal({
            type: "candidate",
            targetId: peerId,
            candidate: event.candidate,
          });
        }
      };

      // 监听远程音视频轨道输入
      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          remoteStreams[peerId] = event.streams[0];
          syncAudioSink();
          renderMultiStage();
        }
      };

      // 监听 P2P 连接状态
      pc.oniceconnectionstatechange = () => {
        if (
          pc.iceConnectionState === "disconnected" ||
          pc.iceConnectionState === "failed" ||
          pc.iceConnectionState === "closed"
        ) {
          closePeerConnection(peerId);
          syncAudioSink();
          renderMultiStage();
        }
      };

      return pc;
    }

    // 关闭指定 P2P 连接
    function closePeerConnection(peerId) {
      if (peerConnections[peerId]) {
        peerConnections[peerId].close();
        delete peerConnections[peerId];
      }
      if (remoteStreams[peerId]) {
        delete remoteStreams[peerId];
      }
    }

    // 同步后台专用音频播放池 (保证声音播放稳定无回声)
    function syncAudioSink() {
      if (!audioSink) return;
      // 为每个 remoteStream 维护唯一的 audio 节点
      const activeIds = new Set(Object.keys(remoteStreams));
      
      // 清除失效的 audio 节点
      Array.from(audioSink.children).forEach((el) => {
        const id = el.getAttribute("data-peer-id");
        if (!activeIds.has(id)) {
          el.pause();
          el.srcObject = null;
          el.remove();
        }
      });

      // 添加或更新现有的 audio 节点
      activeIds.forEach((id) => {
        let el = audioSink.querySelector(`audio[data-peer-id="${id}"]`);
        if (!el) {
          el = document.createElement("audio");
          el.autoplay = true;
          el.setAttribute("data-peer-id", id);
          audioSink.appendChild(el);
        }
        if (el.srcObject !== remoteStreams[id]) {
          el.srcObject = remoteStreams[id];
        }
      });
    }

    // 点击对调主副屏 (Click to Swap)
    window.swapStage = function (targetUserId) {
      if (!targetUserId || targetUserId === focusedUserId) return;
      focusedUserId = targetUserId;
      renderMultiStage();
    };

    // 核心：自适应多画面主副屏渲染器 (Stage & Gallery)
    function renderMultiStage() {
      if (!mainStageVideo || !mainStageAudio) return;

      // 1. 汇总所有参会人列表
      const participantSet = new Set();
      if (localStream || inChannel) {
        participantSet.add(localID);
      }
      channelUsers.forEach((id) => participantSet.add(id));
      Object.keys(remoteStreams).forEach((id) => participantSet.add(id));

      const participants = Array.from(participantSet);
      if (participants.length === 0) {
        participants.push(localID);
      }

      // 2. 校验 focusedUserId
      if (!focusedUserId || !participants.includes(focusedUserId)) {
        focusedUserId = participants[0] || localID;
      }

      // 3. 巧妙指示人数 (零空间占用的微型状态胶囊)
      if (stageCountPill) {
        if (callMode === "direct") {
          stageCountPill.classList.remove("hidden");
          if (isDirectCallingWait) {
            stageCountPill.innerText = "正在呼叫...";
          } else {
            stageCountPill.innerText = "私密通话";
          }
        } else if (callMode === "group") {
          stageCountPill.classList.remove("hidden");
          const roomLabel = currentRoomName ? `${currentRoomName} · ` : "";
          stageCountPill.innerText = `${roomLabel}${participants.length}人`;
        } else if (participants.length > 1) {
          stageCountPill.classList.remove("hidden");
          stageCountPill.innerText = `${participants.length}人`;
        } else {
          stageCountPill.classList.add("hidden");
        }
      }

      // 4. 渲染左侧大块 (Main Stage) - 展示 focusedUserId
      const isFocusedMe = (focusedUserId === localID) || (typeof socket !== "undefined" && socket && focusedUserId === socket.id);
      if (stageUserTitle) {
        if (callMode === "direct") {
          if (isDirectCallingWait) {
            stageUserTitle.innerText = `呼叫中: ${currentDirectPeer ? currentDirectPeer.substring(0, 6) : ""}...`;
          } else {
            stageUserTitle.innerText = isFocusedMe
              ? "一对一: 本地 (我)"
              : `一对一: ${focusedUserId.substring(0, 6)}...`;
          }
        } else if (callMode === "group") {
          stageUserTitle.innerText = isFocusedMe
            ? "群聊: 本地 (我)"
            : `群聊: ${focusedUserId.substring(0, 6)}...`;
        } else {
          if (!inChannel && !localStream) {
            stageUserTitle.innerText = "未在通话中";
          } else {
            stageUserTitle.innerText = isFocusedMe
              ? "本地 (我)"
              : `用户 ${focusedUserId.substring(0, 6)}...`;
          }
        }
      }

      let focusedStream = isFocusedMe ? localStream : remoteStreams[focusedUserId];
      let hasVideo = false;

      if (isFocusedMe) {
        hasVideo = isCamEnabled && !!localStream && localStream.getVideoTracks().some((t) => t.enabled);
      } else if (focusedStream) {
        hasVideo = focusedStream.getVideoTracks().length > 0 && focusedStream.getVideoTracks().some((t) => t.enabled);
      }

      if (hasVideo && focusedStream) {
        mainStageVideo.classList.remove("hidden");
        mainStageAudio.classList.add("hidden");
        if (mainStageVideo.srcObject !== focusedStream) {
          mainStageVideo.srcObject = focusedStream;
        }
      } else {
        mainStageVideo.classList.add("hidden");
        mainStageAudio.classList.remove("hidden");
        mainStageVideo.srcObject = null;
      }

      // 5. 渲染右侧缩略画廊 (Gallery Thumbnails) - 展示非 focused 参与者
      const otherParticipants = participants.filter((id) => id !== focusedUserId);

      if (!thumbsGallery) return;

      if (otherParticipants.length === 0) {
        thumbsGallery.classList.add("hidden");
        thumbsGallery.innerHTML = "";
      } else {
        thumbsGallery.classList.remove("hidden");
        thumbsGallery.innerHTML = "";

        otherParticipants.forEach((peerId) => {
          const card = document.createElement("div");
          card.className = "rtc-thumb-card";
          card.title = "点击切换至大屏";
          card.onclick = () => window.swapStage(peerId);

          const isPeerMe = (peerId === localID) || (typeof socket !== "undefined" && socket && peerId === socket.id);
          const peerStream = isPeerMe ? localStream : remoteStreams[peerId];
          const isPeerConnected = isPeerMe ? !!localStream : !!remoteStreams[peerId];

          let peerHasVideo = false;
          if (isPeerMe) {
            peerHasVideo = isCamEnabled && !!localStream && localStream.getVideoTracks().some((t) => t.enabled);
          } else if (peerStream) {
            peerHasVideo = peerStream.getVideoTracks().length > 0 && peerStream.getVideoTracks().some((t) => t.enabled);
          }

          if (peerHasVideo && peerStream) {
            const vid = document.createElement("video");
            vid.autoplay = true;
            vid.playsInline = true;
            vid.muted = true;
            vid.srcObject = peerStream;
            card.appendChild(vid);
          } else {
            // 音频卡片动效
            const audioBox = document.createElement("div");
            audioBox.className = "thumb-audio-box";
            audioBox.innerHTML = `
              <div class="thumb-ring"></div>
              <div class="thumb-avatar"><i class="fa-solid fa-microphone"></i></div>
            `;
            card.appendChild(audioBox);
          }

          // 如果是在线群聊频道成员但尚未连线，提供微型呼叫按钮 (仅群聊模式且非自己)
          if (!isPeerMe && !isPeerConnected && callMode === "group") {
            const callBtn = document.createElement("button");
            callBtn.className = "thumb-call-btn";
            callBtn.title = "呼叫成员";
            callBtn.innerHTML = '<i class="fa-solid fa-phone"></i>';
            callBtn.onclick = (e) => {
              e.stopPropagation();
              window.callPeer(peerId);
            };
            card.appendChild(callBtn);
          }

          // 角标用户标识
          const badge = document.createElement("span");
          badge.className = "thumb-badge";
          badge.innerText = isPeerMe ? "我" : `${peerId.substring(0, 6)}...`;
          card.appendChild(badge);

          // 悬停交换提示层
          const swapOverlay = document.createElement("div");
          swapOverlay.className = "thumb-swap-overlay";
          swapOverlay.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>';
          card.appendChild(swapOverlay);

          thumbsGallery.appendChild(card);
        });
      }
      resetControlsAutoHide();
    }

    // 退出并关闭音视频抽屉 (供右上角 X 按钮调用)
    window.handleCloseRtcPanel = function () {
      if (inChannel) {
        handleLeaveChannel(true);
      } else {
        releaseLocalMedia();
      }
      if (typeof toggleRtcPanel === "function") {
        toggleRtcPanel(false);
      }
    };

    // 暴露给外部模块调用的状态与释放函数
    window.releaseLocalMedia = releaseLocalMedia;
    window.isRtcInChannel = () => inChannel;
    window.hasLocalStream = () => !!localStream;

    // 页面刷新、后退或关闭时，确保完全停止释放所有音视频轨道与麦克风
    window.addEventListener("beforeunload", () => {
      if (inChannel) {
        handleLeaveChannel(false);
      } else {
        releaseLocalMedia();
      }
    });

    window.addEventListener("pagehide", () => {
      if (inChannel) {
        handleLeaveChannel(false);
      } else {
        releaseLocalMedia();
      }
    });

    // 暴露给外部调试
    window.__rtcDebug = {
      getParticipants: () => Array.from(channelUsers),
      getRemoteStreams: () => remoteStreams,
      getFocusedUser: () => focusedUserId,
      getLocalStream: () => localStream,
      isMicActive: () => !!localStream && localStream.getAudioTracks().some((t) => t.readyState === "live"),
      renderMultiStage: renderMultiStage,
      releaseLocalMedia: releaseLocalMedia,
    };
  });
})();
