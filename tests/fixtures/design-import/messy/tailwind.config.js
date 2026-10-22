const extra = require('./colors');
module.exports = {
  theme: {
    extend: {
      colors: {
        accent: '#e4572e',
        gray: { 100: '#f7f7f7', 900: '#333333' },
        computed: extra.blue,
      },
      borderRadius: { DEFAULT: '3px' },
    },
  },
};
