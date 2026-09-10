(() => {
  window.addEventListener("load", () => {
    const previewButton = document.getElementById("preview-button");
    const joinChannelButton = document.getElementById("join-channel-button");
    const leaveChannelButton = document.getElementById("leave-channel-button");
    const localVideo = document.getElementById("local-video");
    const audioCheckbox = document.getElementById("audio-checkbox");
    const videoCheckbox = document.getElementById("video-checkbox");
    const remoteList = document.getElementById("remote-list");
    const rtcRemoteList = document.getElementById("rtc-remote-list");

    if (!previewButton || !joinChannelButton) return;

    let localStream = null;
    let inChannel = false;
    let channelUsers = new Set();
    
    // 存储与各远端用户的 RTCPeerConnection: targetId -> RTCPeerConnection
    let peerConnections = {};
    // 存储各远端用户的 MediaStream: targetId -> MediaStream
    let remoteStreams = {};

    // Google 公网 STUN 服务器配置 (用于 NAT 穿越与 P2P 建设)
    const rtcConfig = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
      ],
    };

    // 监听摄像头/麦克风开关控制
    if (audioCheckbox) {
      audioCheckbox.addEventListener("change", function () {
        if (localStream) {
          localStream.getAudioTracks().forEach((t) => (t.enabled = this.checked));
        }
      });
    }

    if (videoCheckbox) {
      videoCheckbox.addEventListener("change", function () {
        if (localStream) {
          localStream.getVideoTracks().forEach((t) => (t.enabled = this.checked));
        }
      });
    }

    // 预览摄像头
    previewButton.onclick = async () => {
      await initLocalMedia();
    };

    // 加入频道
    joinChannelButton.onclick = async () => {
      if (inChannel) {
        showAlert("你已经在频道内！", "warning");
        return;
      }
      if (!localStream) {
        let success = await initLocalMedia();
        if (!success) return;
      }

      inChannel = true;
      channelUsers.add(localID);
      joinChannelButton.disabled = true;
      leaveChannelButton.disabled = false;

      // 向所有在线客户端广播加入频道事件
      sendRtcSignal({
        type: "joinChannel",
        userId: localID,
      });

      showAlert("已成功加入音视频频道", "success");
      renderChannelUsers();
    };

    // 退出频道
    leaveChannelButton.onclick = () => {
      handleLeaveChannel();
    };

    function handleLeaveChannel() {
      if (!inChannel) return;

      inChannel = false;
      channelUsers.delete(localID);

      // 广播退出频道
      sendRtcSignal({
        type: "leaveChannel",
        userId: localID,
      });

      // 关闭所有 P2P 连接
      for (let peerId in peerConnections) {
        closePeerConnection(peerId);
      }

      peerConnections = {};
      remoteStreams = {};

      joinChannelButton.disabled = false;
      leaveChannelButton.disabled = true;

      renderChannelUsers();
      renderRemoteVideos();

      showAlert("你已退出音视频频道", "warning");
    }

    // 初始化本地视音频流
    async function initLocalMedia() {
      try {
        const constraints = {
          audio: audioCheckbox ? audioCheckbox.checked : true,
          video: videoCheckbox ? videoCheckbox.checked : true,
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (localVideo) {
          localVideo.srcObject = localStream;
        }
        showAlert("本地摄像头已开启", "success");
        return true;
      } catch (err) {
        console.error("无法获取本地音视频流:", err);
        showAlert("无法打开摄像头/麦克风，请检查硬件权限", "danger");
        return false;
      }
    }

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
        if (senderId === localID) return;

        switch (data.type) {
          case "joinChannel":
            channelUsers.add(data.userId);
            renderChannelUsers();
            showAlert(`成员 ${data.userId.substring(0, 6)}... 加入了频道`, "info");
            break;

          case "leaveChannel":
            channelUsers.delete(data.userId);
            closePeerConnection(data.userId);
            renderChannelUsers();
            renderRemoteVideos();
            showAlert(`成员 ${data.userId.substring(0, 6)}... 退出了频道`, "warning");
            break;

          case "offer":
            if (!inChannel) return;
            await handleReceiveOffer(senderId, data.sdp);
            break;

          case "answer":
            if (!inChannel) return;
            await handleReceiveAnswer(senderId, data.sdp);
            break;

          case "candidate":
            if (!inChannel) return;
            await handleReceiveCandidate(senderId, data.candidate);
            break;
        }
      });
    }

    initSocketListeners();

    // 主动拨打某位频道成员 (创建 Offer)
    window.callPeer = async function (targetId) {
      if (!inChannel) {
        showAlert("请先加入音视频频道！", "warning");
        return;
      }
      if (targetId === localID) return;

      showAlert(`正在呼叫用户 ${targetId.substring(0, 6)}...`, "info");

      const pc = createPeerConnection(targetId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendRtcSignal({
        type: "offer",
        targetId: targetId,
        sdp: offer,
      });
    };

    // 收到 Offer，创建并回应 Answer
    async function handleReceiveOffer(senderId, offerSdp) {
      const pc = createPeerConnection(senderId);
      await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendRtcSignal({
        type: "answer",
        targetId: senderId,
        sdp: answer,
      });

      showAlert(`已接听来自 ${senderId.substring(0, 6)}... 的呼叫`, "success");
    }

    // 收到 Answer，设置 RemoteDescription
    async function handleReceiveAnswer(senderId, answerSdp) {
      const pc = peerConnections[senderId];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
        showAlert(`与 ${senderId.substring(0, 6)}... P2P 打通成功！`, "success");
      }
    }

    // 收到 ICE Candidate
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

      // 绑定本地媒体流轨道
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
        console.log(`收到来自 ${peerId} 的媒体轨道:`, event.streams);
        if (event.streams && event.streams[0]) {
          remoteStreams[peerId] = event.streams[0];
          renderRemoteVideos();
        }
      };

      // 监听 P2P 连接状态
      pc.oniceconnectionstatechange = () => {
        console.log(`与 ${peerId} 连接状态:`, pc.iceConnectionState);
        if (
          pc.iceConnectionState === "disconnected" ||
          pc.iceConnectionState === "failed" ||
          pc.iceConnectionState === "closed"
        ) {
          closePeerConnection(peerId);
          renderRemoteVideos();
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

    // 渲染频道在线人列表
    function renderChannelUsers() {
      if (!remoteList) return;
      remoteList.innerHTML = "";

      if (channelUsers.size === 0) {
        remoteList.innerHTML = `<div style="color:var(--text-dim);font-size:0.8rem;text-align:center;padding:10px;">频道暂无在线成员</div>`;
        return;
      }

      channelUsers.forEach((id) => {
        let isMe = id === localID;
        let isConnected = !!peerConnections[id];

        let item = document.createElement("div");
        item.className = `user-item ${isMe ? "is-me" : ""} ${isConnected ? "connected" : ""}`;

        let nameSpan = document.createElement("span");
        nameSpan.innerText = isMe ? `${id.substring(0, 8)}... (我)` : `${id.substring(0, 10)}...`;

        item.appendChild(nameSpan);

        if (!isMe) {
          let callBtn = document.createElement("button");
          callBtn.className = "btn btn-xs btn-primary";
          callBtn.style.marginLeft = "auto";
          callBtn.style.padding = "2px 8px";
          callBtn.style.fontSize = "0.75rem";
          callBtn.innerHTML = isConnected
            ? `<i class="fa-solid fa-phone"></i> 通话中`
            : `<i class="fa-solid fa-phone"></i> 呼叫`;
          callBtn.onclick = () => window.callPeer(id);
          item.appendChild(callBtn);
        }

        remoteList.appendChild(item);
      });
    }

    // 渲染远程视频画面
    function renderRemoteVideos() {
      if (!rtcRemoteList) return;
      rtcRemoteList.innerHTML = "";

      const keys = Object.keys(remoteStreams);
      if (keys.length === 0) {
        rtcRemoteList.innerHTML = `<div style="color:var(--text-dim);font-size:0.8rem;text-align:center;padding:20px;width:100%;">暂无连线视频</div>`;
        return;
      }

      keys.forEach((peerId) => {
        let stream = remoteStreams[peerId];

        let container = document.createElement("div");
        container.className = "video-wrapper remote-video-card";

        let video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        video.srcObject = stream;

        let label = document.createElement("div");
        label.className = "video-label";
        label.innerText = `用户: ${peerId.substring(0, 8)}...`;

        container.appendChild(video);
        container.appendChild(label);
        rtcRemoteList.appendChild(container);
      });
    }
  });
})();
