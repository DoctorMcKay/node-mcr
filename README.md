# My Coke Rewards

This module allows you to redeem My Coke Rewards codes through node.js.

# Installation

Just install from npm:

    $ npm install mcr

# Usage

The module exports the `MyCokeRewards` "class". Construct a `MyCokeRewards` object with your
`username` (email address) and `password`:

```js
var MyCokeRewards = require('mcr');
var coke = new MyCokeRewards('you@example.com', 'yourpassword');
```

Then call the available methods. If necessary, the module will login as needed.

# Methods

### redeemCode(code, callback)
- `code` - Your code, as a string. Spaces will be stripped and all characters will be uppercased.
- `callback` - A function to be called when the request completes
	- `err` - If a network error occurred, this is an `Error` object. Otherwise, it's `null`.
	- `message` - If mycokerewards.com sent back an error message, this is it as a string. Otherwise, it's `null`.
	- `earned` - How many points you earned from redeeming this code
	- `balance` - Your new total points balance

Redeems a My Coke Rewards code.

### getEarnedPoints(callback)
- `callback` - A function to be called when the request completes
	- `err` - If an error occurred, this is an `Error` object. Otherwise, it's `null`.
	- `earned` - How many points you've earned this week
	- `limit` - How many total points you can earn this week

Gets how many points you've earned so far, and how many you can earn total this week.

Weeks reset on Mondays at midnight EST.
