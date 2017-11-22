module.exports = {
  _ns: 'zenbot',

  'strategies.bb': require('./strategy'),
  'strategies.list[]': '#strategies.bb'
}
