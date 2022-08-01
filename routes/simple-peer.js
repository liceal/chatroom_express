// simple-peer demo
var express = require("express");
var router = express.Router();

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("simple-peer", { title: "Express" });
});

module.exports = router;
