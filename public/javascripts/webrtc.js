(() => {
  window.addEventListener("load", () => {
    const previewButton = document.getElementById("preview-button");
    const joinChannelButton = document.getElementById("join-channel-button");
    const leaveChannelButton = document.getElementById("leave-channel-button");
    const localVideo = document.getElementById("local-video");
    const remoteVideo = document.getElementById("remote-video");
    const audioCheckbox = document.getElementById("audio-checkbox");
    const videoCheckbox = document.getElementById("video-checkbox");
    const remoteList = document.getElementById("remote-list");
    const rtcRemoteList = document.getElementById("rtc-remote-list");
    joinChannelButton.disabled = false;
    leaveChannelButton.disabled = true;

    let localStream;
    const mediaOptions = {
      audio: audioCheckbox.checked,
      video: videoCheckbox.checked,
    };
    let answerId2OfferPc = {}; //对那些answer发送了offer，记录answerId和对方端
    let offerId2AnswerPc = {}; // 收到那些offer，记录offerId和对方端

    let offerSdp2offerId = {}; //offerSdp>offerId 当我作为answer的到多个offer时 记录 offerSdp:offerId
    let offerId2offerSdp = {}; //offerId>offerSdp

    let offerSdp2offerStream = {}; //offerSdp映射offer传来的流

    previewButton.onclick = () => {
      console.log("预览");
      handlePreview();
    };

    joinChannelButton.onclick = () => {
      console.log("加入频道");
      handleAddChannel();
    };

    leaveChannelButton.onclick = () => {
      console.log("退出频道");
      handleLeaveChannel();
    };

    audioCheckbox.addEventListener("change", async function () {
      console.log(this.checked);
      mediaOptions.audio = this.checked;
    });

    videoCheckbox.addEventListener("change", async function () {
      console.log(this.checked);
      mediaOptions.video = this.checked;
    });

    // 预览
    async function handlePreview() {
      await initLocalMedia();
    }

    // 加入频道
    async function handleAddChannel() {
      if (onlinesID.has(localID)) {
        alert(`你已经在频道内，ID：${localID}`);
        return;
      }
      // 加入频道前，先打开自己的预览摄像头,创建流
      if (!localStream) {
        showAlert("加入频道前，先打开预览", "warning");
        return;
      }
      onlinesID.add(localID);
      console.log("目前自己频道id数", onlinesID);
      updateChannelUserList(onlinesID);
      signaling.postMessage({ type: "updateChannelUserList", onlinesID });
      joinChannelButton.disabled = true;
      leaveChannelButton.disabled = false;
    }

    // 退出频道
    async function handleLeaveChannel() {
      // 删除自己发出的所有offer 和 作为所有的answer pc
      for (let id in answerId2OfferPc) {
        answerId2OfferPc[id].close();
        answerId2OfferPc[id] = null;
      }
      answerId2OfferPc = {};
      for (let id in offerId2AnswerPc) {
        offerId2AnswerPc[id].close();
        offerId2AnswerPc[id] = null;
      }
      answerId2OfferPc = {};
      offerSdp2offerId = {};
      offerId2offerSdp = {};
      offerSdp2offerStream = {};
      updateChannelUserList(onlinesID);
      initOfferStreamVideo();

      showAlert(`用户ID：<strong>${localID}</strong>退出频道`, "warning");
      // 在频道在线人列表内删除自己
      onlinesID.delete(localID);
      updateChannelUserList(onlinesID);
      signaling.postMessage({
        type: "someoneQuitChannel",
        id: localID,
        onlinesID,
      });
      joinChannelButton.disabled = false;
      leaveChannelButton.disabled = true;
    }

    //初始化媒体流
    async function initLocalMedia() {
      localStream = await navigator.mediaDevices.getUserMedia(mediaOptions);
      localVideo.srcObject = localStream;
    }

    //建立广播通道
    let onlinesID = new Set();
    const signaling = new BroadcastChannel("webrtc");
    signaling.onmessage = async (e) => {
      switch (e.data.type) {
        case "answerChannelUserList":
          // 收到答复 频道人员列表
          answerChannelUserList(e.data.onlinesID);
          break;
        case "askChannelUserList":
          // 询问频道其他人目前加入频道的人员列表
          askChannelUserList();
          break;
        case "updateChannelUserList":
          updateChannelUserList(e.data.onlinesID);
          break;
        case "someoneQuitChannel":
          someoneQuitChannel(e.data.id, e.data.onlinesID);
          break;
        case "offer":
          // 收到offer 创建answer
          handleOffer(e.data);
          break;
        case "answer":
          // 收到answer 给offer设置上answer
          handleAnswer(e.data);
          break;
        case "candidate":
          // answer设置了offer为remote则告诉offer有了一个候选人
          handleCandidate(e.data);
          break;
      }
    };

    // 刚进入页面，询问频道在线人
    signaling.postMessage({ type: "askChannelUserList" });

    // 收到频道人员列表
    async function answerChannelUserList(list) {
      if (!onlinesID.size) {
        console.log("初始频道在线人数");
        updateChannelUserList(list);
      }
    }

    // 有人询问频道在线人列表，返回频道在线人列表
    async function askChannelUserList() {
      console.log(`有人询问频道在线列表`);
      signaling.postMessage({ type: "answerChannelUserList", onlinesID });
    }

    // 更新在线id
    async function updateChannelUserList(ids) {
      onlinesID = ids;
      console.log("更新频道在线id列表", onlinesID);
      const idsDom = document.createElement("div");
      idsDom.id = "onlines-id";
      idsDom.className = "onlines-id";
      onlinesID.forEach((id) => {
        let idDom = document.createElement("div");
        idDom.id = "online-id";
        idDom.className = "online-id";
        idDom.innerHTML = id;
        // 如果是自己就显示蓝色并且不能选择
        if (id === localID) {
          idDom.className += " online-id-self";
          idDom.classList += " online-id-tips";
          idDom.setAttribute("data-title", "不能选择自己");
        } else {
          idDom.onclick = () => handleOnlineConnection(id);
        }
        // 如果有个id在answer列表里就不允许再点击了
        if (answerId2OfferPc[id]) {
          idDom.className += " online-id-active";
          idDom.classList += " online-id-tips";
          idDom.setAttribute("data-title", "当前主动联系的人");
          idDom.onclick = null;
        }
        idsDom.appendChild(idDom);
        // 如果这个id在offers列表里面也不允许点击了
        if (offerId2AnswerPc[id]) {
          idDom.className += " online-id-answer";
          idDom.classList += " online-id-tips";
          idDom.setAttribute("data-title", "这人已经拨打给你了");
          idDom.onclick = null;
        }

        // 如果在看我的人里面answerStream 就标记
        // if (offerSdp2offerStream[offerId2offerSdp[id]]) {
        //   idDom.className += " online-id-answer";
        //   idDom.classList += " online-id-tips";
        //   idDom.setAttribute("data-title", "这人已经拨打给你了");
        //   idDom.onclick = null;
        // }
      });
      remoteList.innerHTML = "";
      remoteList.appendChild(idsDom);
    }

    // 有人退出了频道
    async function someoneQuitChannel(id, onlinesID) {
      // 有个用户退出了，如果我是answer，他是主动连接我的人然后断开了，那就本地删除链接我的人
      let answerPc = offerId2AnswerPc[id];
      if (answerPc) {
        delete offerSdp2offerId[answerPc.currentRemoteDescription.sdp];
        delete offerSdp2offerStream[offerId2offerSdp[offer.offerId]];
        offerId2AnswerPc[id] && offerId2AnswerPc[id].close();
        offerId2AnswerPc[id] = null;
      }

      console.log("做为answer连接的offer", offerSdp2offerId);

      showAlert(`用户ID：<strong>${id}</strong>退出频道`, "warning");
      updateChannelUserList(onlinesID);
    }

    // 收到offer描述 创建answer
    async function handleOffer(offer) {
      // 是否是发给我的
      console.log("收到offer", offer);

      // 记录offerId>offerSdp 更新 offerSdp>offerId
      // 如果收到的offer不是自己的，自己又曾经有过这个offer，就要删除这个offer曾经给数据
      if (
        offer.answerId !== localID &&
        (offerSdp2offerId[offerId2offerSdp[offer.offerId]] ||
          offerSdp2offerStream[offerId2offerSdp[offer.offerId]])
      ) {
        delete offerSdp2offerStream[offerId2offerSdp[offer.offerId]];
        updateChannelUserList(onlinesID);
        initOfferStreamVideo();
      }
      // 先删除老的sdp
      delete offerSdp2offerId[offerId2offerSdp[offer.offerId]];
      // 删除老的流
      delete offerSdp2offerStream[offerId2offerSdp[offer.offerId]];
      // 删除老的pc
      if (offerId2AnswerPc[offer.offerId]) {
        offerId2AnswerPc[offer.offerId].close();
        offerId2AnswerPc[offer.offerId] = null;
      }

      // 记录这个offerId 新的 offerSdp
      offerId2offerSdp[offer.offerId] = offer.sdp;
      offerSdp2offerId[offer.sdp] = offer.offerId;

      if (offer.answerId !== localID) {
        return;
      }
      let pc = await createPeerConnection();
      await pc.setRemoteDescription(offer);

      let answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      offerId2AnswerPc[offer.offerId] = pc;

      let message = {
        type: "answer",
        answerId: localID,
        offerId: offer.offerId,
        sdp: answer.sdp,
      };
      signaling.postMessage(message);
    }

    // 收到answer描述 给offer设置上answer
    async function handleAnswer(answer) {
      let offerPc = answerId2OfferPc[answer.answerId];
      if (!offerPc) {
        console.error(
          "给offer设置answer,offer端消失了",
          answerId2OfferPc,
          answer.answerId
        );
        return;
      }
      await offerPc.setRemoteDescription(answer);
    }

    // 收到answer的候选人信息，给offer设置上
    async function handleCandidate(candidate) {
      let offerPc = answerId2OfferPc[candidate.answerId];
      if (!offerPc) {
        console.error(
          "给offer设置condidate，offer端消失了",
          answerId2OfferPc,
          candidate.answerId
        );
        return;
      }
      if (!candidate.candidate) {
        await offerPc.addIceCandidate(null);
      } else {
        await offerPc.addIceCandidate(candidate);
      }
    }

    // 对在线人发出连机申请，本端作为offer
    async function handleOnlineConnection(answerId) {
      // 处理连接之前，要保证自己能提供流
      if (!onlinesID.has(localID)) {
        showAlert("请先加入频道", "warning");
        return;
      }
      let pc = await createPeerConnection();
      // 向在线人发出offer
      let offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // 记录连接answerId，所有用户只能主动连接一个人，所以这个answerId2OfferPc只能有一个
      // answerId2OfferPc[answerId] = pc;
      answerId2OfferPc = {};
      answerId2OfferPc[answerId] = pc;

      let message = {
        type: "offer",
        offerId: localID,
        answerId: answerId,
        sdp: offer.sdp,
      };
      signaling.postMessage(message);
      updateChannelUserList(onlinesID);
    }

    // 创建peer
    async function createPeerConnection() {
      let pc = new RTCPeerConnection();

      pc.onicecandidate = (e) => {
        // 如果answer设置了offer的远程描述 则告诉offer有了一个候选人
        const message = {
          type: "candidate",
          answerId: localID,
          candidate: null,
        };
        if (e.candidate) {
          message.candidate = e.candidate.candidate;
          message.sdpMid = e.candidate.sdpMid;
          message.sdpMLineIndex = e.candidate.sdpMLineIndex;
        }
        signaling.postMessage(message);
      };

      pc.oniceconnectionstatechange = (e) => {
        console.log("连接状态", pc.iceConnectionState);
        if (pc.iceConnectionState === "connected") {
          console.log(
            "完成连接",
            offerId2AnswerPc,
            answerId2OfferPc,
            offerSdp2offerId,
            offerSdp2offerStream
          );
          updateChannelUserList(onlinesID);
          initOfferStreamVideo();
        }
      };

      pc.ontrack = (e) => {
        //如果是answer会得到offer发出的轨道
        console.log("链接完成获得轨道", e, pc);
        if (pc.remoteDescription.type === "answer") {
          remoteVideo.srcObject = e.streams[0];
        } else if (pc.remoteDescription.type === "offer") {
          //如果远程是offer 那我是 answer,记录我连接的所有offer流
          offerSdp2offerStream[pc.remoteDescription.sdp] = e.streams[0];
          // 初始化offer流
        }
      };

      if (localStream) {
        // 有流 把轨道都加上
        localStream
          .getTracks()
          .forEach((track) => pc.addTrack(track, localStream));
      }
      return pc;
    }

    // 初始化offer视频流
    async function initOfferStreamVideo() {
      rtcRemoteList.innerHTML = "";
      for (let sdp in offerSdp2offerStream) {
        let stream = offerSdp2offerStream[sdp];
        let div = document.createElement("div");
        div.className = "rtc-remote-list-contain";
        let span = document.createElement("span");
        span.innerHTML = offerSdp2offerId[sdp];
        let video = document.createElement("video");
        video.setAttribute("playsinline", true);
        video.setAttribute("autoplay", true);
        video.srcObject = stream;
        div.appendChild(span);
        div.appendChild(video);
        rtcRemoteList.appendChild(div);
      }
    }

    // soket监听有用户离开时候，如果用户在频道内则删除
    socket.on("disconneted", (data) => {
      if (onlinesID.has(data._id)) {
        console.log(data, "webrtc管道有用户离开");
        onlinesID.delete(data._id);
        console.log("用户离开聊天室", data._id);
        // showAlert(
        //   `用户ID：<strong>${data._id}</strong>离开聊天室，频道内下线`,
        //   "warning"
        // );
        updateChannelUserList(onlinesID);
        initOfferStreamVideo();
        signaling.postMessage({ type: "updateChannelUserList", onlinesID });
      }
    });
  });
})();
