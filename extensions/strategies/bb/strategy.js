var z = require('zero-fill'),
    n = require('numbro')

module.exports = function container(get, set, clear) {
    return {
        name: 'bb',
        description: 'Buy when (EMA - last(EMA) > 0) and sell when (EMA - last(EMA) < 0).',

        getOptions: function() {
            this.option('on_start', 'Indicate start', Boolean, false)
                //	common parameters				
            this.option('period', 'period length', String, '2m')
            this.option('min_periods', 'min. number of history periods', Number, 50)
            this.option('trend_ema', 'number of periods for long ema', Number, 3)
            this.option('neutral_ema', 'avoid trades if abs(trend_sma) under this float (0 to disable, "auto" for a variable filter)', Number, 0.2)
            this.option('bb_period', 'numbers of periods for bb', Number, 120)
            this.option('atr_period', 'numbers of periods for atr', Number, 21)
            this.option('bb_w', 'koeff for width bb', Number, 2.0)
            this.option('trade_width', 'critical width bb for trade', Number, 3.0)
            this.option('avg_period', 'numbers of periods for price average', Number, 3)
                //	options for buying	
            this.option('buy_bbw', 'if min profit < this value - no buy', Number, 0.1)
            this.option('min_curr', 'buy if have more currency', Number, 50)
                //	options for selling	
            this.option('err_pct', 'err control if price deviate by this pct from trade price', Number, 2.0)
            this.option('sell_bbw', 'if min profit < this value - no selling', Number, 0.1)
            this.option('min_coin', 'sell if have more coins', Number, 0.2)
        },

        calculate: function(s) {
            var bbw, diff
                // ini params & variables
            if (!s.options.on_start) {
                s.trend_ema = s.options.trend_ema
                s.bb_period = s.options.bb_period
                s.atr_period = s.options.atr_period
                if (s.options.min_periods <= s.bb_period) s.options.min_periods = s.bb_period * 1.5
                s.dev_ema = s.options.neutral_ema
                s.buy_pct = 1.0 + s.options.buy_bbw / 100
                s.err_pct = 1.0 + s.options.err_pct / 100
                s.sell_pct = 1.0 + s.options.sell_bbw / 100
                s.min_coin = s.options.min_coin
                s.min_curr = s.options.min_curr
                s.acted = false
                s.length = 0
                s.max_price = 0
                s.min_price = 1000
                s.stop_price = 0
                s.buy_price = 0
                s.sell_price = 1000
                s.up_bb = false
                s.under_bb = false
                s.start_buy = false
                s.start_sell = false
                s.bbw = 0
                s.options.on_start = true
                s.global_up = s.global_down = false
                s.full_width = s.half_width = false
            }
            // Calculate indicators my_price, EMA trend, SMA, BB
            //			get('lib.ema')(s, 'avg_price', s.options.avg_period)
            get('lib.sma')(s, 'avg_price', s.options.avg_period) //average price
            s.my_price = s.period.avg_price
            get('lib.sma')(s, 'sma', s.bb_period)
            get('lib.ema')(s, 'ema', s.trend_ema)
            if (s.lookback[0]) s.period.tr = Math.max(s.period.high - s.period.low, s.period.high - s.lookback[0].close, s.lookback[0].close - s.period.low)
            if (s.lookback.length > s.length) { //define next period
                s.acted = false
                s.length = s.lookback.length
            }
            s.global_up = s.global_down = false
                // ATR
            get('lib.sma')(s, 'atr', s.atr_period, 'tr')
            if (s.period.sma && s.lookback[s.bb_period] && s.lookback[s.bb_period].sma) {
                //	Define EMA trend
                s.ema_rate = (s.lookback[0].ema - s.lookback[10].ema) / s.lookback[10].ema * 10
                if (s.ema_rate > s.dev_ema) s.global_up = true
                else if (s.ema_rate < -1 * s.dev_ema) s.global_down = true
                    // Bollinger Bands		
                get('lib.stddev')(s, 'bb', s.bb_period, 'close')
                s.bbw = s.period.bb * s.options.bb_w
                s.w_bb = s.bbw * 100 / s.period.sma
                s.up_rate = (s.lookback[0].sma - s.lookback[10].sma + (s.lookback[0].bb - s.lookback[10].bb) * s.options.bb_w) / (s.lookback[10].sma + s.lookback[10].bb * s.options.bb_w) * 10
                s.down_rate = (s.lookback[0].sma - s.lookback[10].sma - (s.lookback[0].bb - s.lookback[10].bb) * s.options.bb_w) / (s.lookback[10].sma - s.lookback[10].bb * s.options.bb_w) * 10
                if (s.w_bb > s.options.trade_width) s.full_width = true
                else if (s.w_bb > s.options.trade_width / 2) s.half_width = true
                else s.full_width = s.half_width = false
            }
        },

        onPeriod: function(s, cb) {
            var go_buy = go_sell = false
            if (typeof s.up_rate === 'undefined') return cb() //check valid data on start
                // Define stop_loss
            if (s.stop_price < s.period.close - s.period.atr * 2) s.stop_price = s.period.close - s.period.atr
                // Define balance of coins 
            if (s.balance.asset > s.min_coin) {
                // Sell logic
                //	Fix out_side bb - upper bb_up
                if (s.period.high >= s.period.sma + s.bbw) {
                    if (!s.up_bb) {
                        s.up_bb = true
                        s.under_bb = false
                        s.start_buy = false
                        s.start_sell = false
                        s.max_price = s.my_price
                    }
                }
                // Start sell if ...
                if (s.w_bb < s.options.trade_width / 2) { //Very tight bb - only correct mistakes 	
                    if (s.start_sell && s.global_up) s.start_sell = false
                    else if (!s.start_sell && s.global_down) s.start_sell = true
                } else { //Medium or large bb - trade outside bb
                    // if price raises bb_up by 14pct from bb width 
                    if (!s.start_sell && (s.my_price > s.buy_price * s.err_pct || s.my_price > s.period.sma + 1.14 * s.bbw)) {
                        s.start_sell = true
                        s.max_price = s.my_price
                    }
                    if (s.w_bb >= s.options.trade_width) { //Large bb - trade inside bb
                        // if price cross sma by 50pct from bb width & foll
                        if (!s.start_sell && s.my_price > s.period.sma + 0.5 * s.bbw) {
                            s.start_sell = true
                            s.max_price = s.my_price
                        }
                    }
                }
                //				else if (s.global_up || s.w_bb < 0.55 & !s.global_down) s.start_sell = false
                if (s.start_sell && s.my_price < s.max_price / s.buy_pct) go_sell = true
                    // Fix new max price
                else if (s.my_price > s.max_price) s.max_price = s.my_price
                console.log('in_coin ' + s.start_sell + ' price ' + s.my_price + ' max ' + (s.max_price / s.buy_pct) + ' sma ' + s.period.sma + ' w ' + s.bbw + ' up ' + s.up_rate + ' atr ' + s.period.atr + ' stop ' + s.stop_price)
                if (!s.acted && !s.global_up && go_sell) {
                    s.signal = 'sell'
                    s.start_sell = false
                    s.start_buy = false
                    s.acted = true
                    s.min_price = s.my_price
                    s.max_price = s.my_price
                    s.sell_price = s.my_price
                }
                return cb()
            }
            // Define balance of currency 
            if (s.balance.currency > s.min_curr) {
                //	Buy logic
                if (s.period.low <= s.period.sma - s.bbw) {
                    //	Fix price under bb_down 
                    if (!s.under_bb) {
                        s.under_bb = true
                        s.up_bb = false
                        s.start_sell = false
                        s.min_price = s.my_price
                    }
                }
                /*			else if (s.period.high >=  s.period.sma + s.bbw) {
                // Trade for correct mistake
                				s.up_bb = true
                				s.under_bb = false
                				s.min_price = s.my_price
                				s.start_buy = true
                			} */
                // Start buy if ...
                if (!s.start_buy) {
                    // if price fell below bb by 14pct from bb width
                    if (s.my_price < s.sell_price / s.err_pct && s.my_price < s.period.sma - 1.14 * s.bbw) {
                        s.start_buy = true
                        s.min_price = s.my_price
                    }
                    // if price cross sma & foll 
                    /*				if (s.my_price < s.sell_price/s.err_pct &&  s.my_price < s.period.sma - 1.14*s.bbw) {
                    					s.start_buy = true
                    					s.min_price = s.my_price
                    				} */
                }
                //				else if (s.global_down || !s.global_up && s.w_bb < 0.55) s.start_buy = false
                if (s.start_buy && s.my_price > s.min_price * s.buy_pct) go_buy = true
                    // Fix new min price
                else if (s.my_price < s.min_price) s.min_price = s.my_price
                console.log('in_curr ' + s.start_buy + ' price ' + s.my_price + ' min ' + (s.min_price * s.buy_pct) + ' sma ' + s.period.sma + ' w ' + s.bbw + ' down ' + s.down_rate + ' atr ' + s.period.atr + ' stop ' + s.stop_price)
                if (!s.acted && !s.global_down && go_buy) {
                    s.signal = 'buy'
                    s.start_buy = false
                    s.start_sell = false
                    s.acted = true
                    s.min_price = s.my_price
                    s.max_price = s.my_price
                    s.buy_price = s.my_price
                    s.stop_price = s.my_price - s.period.atr
                }
                return cb()
            }
        },

        onReport: function(s) {
            var cols = []
                //     var color = 'grey'
                //        	if (s.period.ema_rate > s.dev_ema) cols.push(z(8, n(s.period.close).format('000.00'), ' ').green)
                //        	else if (s.period.ema_rate < s.dev_ema * -1) cols.push(z(8, n(s.period.close).format('000.00'), ' ').red)
                //       	else cols.push(z(8, n(s.period.close).format('000.00'), ' ').grey)

            if (s.ema_rate > s.dev_ema) cols.push(z(7, n(s.ema_rate).format('0.000'), ' ').green)
            else if (s.ema_rate < s.dev_ema * -1) cols.push(z(7, n(s.ema_rate).format('0.000'), ' ').red)
            else cols.push(z(7, n(s.ema_rate).format('0.000'), ' ').grey)
                //			cols.push(z(8, n(s.period.bb_up).format('0.0000'), ' ').green)
                //			cols.push(z(8, n(s.period.sma_rate).format('0.0000'), ' ').grey)
                //			cols.push(z(8, n(s.period.bb_down_rate).format('0.0000'), ' ').red)
            if (s.up_bb) cols.push(z(6, n(s.w_bb).format('0.00'), ' ').green)
            else if (s.under_bb) cols.push(z(6, n(s.w_bb).format('0.00'), ' ').red)

            return cols
        }
    }
}