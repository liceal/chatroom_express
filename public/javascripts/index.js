var sendMsgInput = null
var contentDom = null
var listDom = null
var userDom = null
var socket = null
var list = null


window.onload = () => {

  socket = io()

  console.log('socket实例', socket);

  contentDom = $('#content')[0]
  sendMsgInput = $('#sendMsg')[0]
  listDom = $('#list')[0]

  //连接成功
  socket.on('connected', (data) => {
    console.log('连接成功', data);
    userDom = $('#user')[0];
    userDom.innerHTML = `ID：${data._id}`;
    // insertMsg(data.msg)
    initRooms(data.rooms)
    showAlert(`你的ID是：<strong>${data._id}</strong>`, 'info')
  })

  //新用户加入
  socket.on('rooms', (data) => {
    console.log('新用户加入', data);
    initRooms(data.rooms)
    showAlert(`ID：<strong>${data._id}</strong> 上线`)
  })

  //有用户离开
  socket.on('disconneted', (data) => {
    console.log('有用户离开', data);
    initRooms(data.rooms)
    showAlert(`ID：<strong>${data._id}</strong> 下线`, 'warning')
  })

  //接收消息
  socket.on('message', (data) => {
    console.log('服务端消息', data);
    insertMsg(data.msg)
  })

}

//回车发送消息
function enterSend(event) {
  if (event.keyCode === 13) {
    send()
  }
}

//发送消息
function send() {
  let sendMsg = sendMsgInput.value
  if (sendMsg === "") {
    return
  }
  sendMsgInput.value = ""
  socket.emit('message', sendMsg)
}

//插入消息队列
function insertMsg(msg) {
  let line = document.createElement('div')
  line.className = 'line'
  line.innerHTML = msg
  contentDom.appendChild(line)
  contentDom.scrollTop = contentDom.scrollHeight //滚动条到最底部
}

// 初始化在线人
function initRooms(rooms) {
  console.log('在线人', rooms);
  listDom.innerHTML = ""
  let lines = document.createElement('div')
  lines.id = 'lines'
  rooms.forEach((v) => {
    let line = document.createElement('div')
    line.className = "line"
    line.innerHTML = v
    lines.appendChild(line)
  })
  listDom.appendChild(lines)

}

//弹窗
function showAlert(msg = "弹窗消息", type = "success") {
  let alertDom = document.createElement('div')
  alertDom.className = [`alert alert-${type}`]
  alertDom.setAttribute('role', 'alert')
  alertDom.innerHTML = `
  ${msg}
  <button type="button" class="close" data-dismiss="alert" aria-label="Close">
    <span aria-hidden="true">&times;</span>
  </button>
  `
  $('#alert-container')[0].appendChild(alertDom)

  //使用jq获取dom本身可以得到proto继承属性
  alertDom = $(alertDom)

  setTimeout(() => {
    alertDom.alert('close')
  }, 3000)
}