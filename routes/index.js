var express = require('express');
var router = express.Router();
var multer = require('multer')
var fs = require('fs');
var upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, 'public/file') //参数1 错误信息，参数2 保存文件位置 需要手动创建
    },
    filename(req, file, cb) {
      cb(null, `${Date.now()}--${file.originalname}`) //参数2 自定义文件名
    }
  })
})

/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('index', { title: 'Express' });
});

//* 接收资源文件 并且保存在本地
router.post('/file', upload.single('file'), function (req, res, next) {
  // console.log('req body', req.body) // 请求体
  // console.log('req file', req.file) // 请求发来的file资源
  if (req.file.fieldname) {
    res.status(200).send({ file: req.file })
  }
})

//* 删除资源文件
router.delete('/file', function (req, res, next) {
  console.log('删除文件', req.query);
  fs.unlink(`${__dirname}/../public/file/${req.query.fileName}`, (err) => {
    if (err) {
      console.log(err);
      res.send({
        status: 500,
        msg: '文件删除失败',
        file: req.query.fileName
      })
      return false;
    }
    res.send({
      status: 200,
      msg: '文件删除成功',
      file: req.query.fileName
    })
  })
})

module.exports = router;
