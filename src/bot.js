const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();
const fraudwall_token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(fraudwall_token);

const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = process.env.PORT;
const webhook_url = process.env.WEBHOOK;

const FormData = require('form-data');


app.use(bodyParser.json());

app.post(`/bot${fraudwall_token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

bot.setWebHook(`${webhook_url}/bot${fraudwall_token}`);

bot.on('webhook_error', (error) => {
  console.log(error);
});


const userStates = {};
let token = '';

const axiosInstance = axios.create();

axiosInstance.interceptors.request.use(
  (config) => {
    if (config.url.includes('/api/report')) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);


bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const welcomeMsg = process.env.WELCOME_MESSAGE || 'Welcome to Fraudwall bot!';

  if (msg.text === '/start' || msg.text === '/verify' || msg.text === '/report') {
    const keyboard = {
      inline_keyboard: [
        [
          { text: 'Verify', callback_data: '/verify' },
          { text: 'Report', callback_data: '/report' }
        ]
      ]
    };
    bot.sendMessage(chatId, welcomeMsg, { reply_markup: keyboard });
  }
});



bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;

  if (query.data === '/verify') {
    userStates[chatId] = 'verifying';
    bot.sendMessage(chatId, 'Please enter your phone number:(+233XXXXXXXX)');
  } else if (query.data === '/report') {
    userStates[chatId] = 'reporting';
    bot.sendMessage(chatId, 'Please provide your number to be verified(+233XXXXXXXX): ');
  }

  bot.answerCallbackQuery(query.id);
});


bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '/start') {
  } else if (userStates[chatId] === 'verifying') {
    handleVerify(chatId, text);
  } else if (userStates[chatId] === 'reporting') {
    handleReport(chatId, text);
  } else if (text !== '/verify' && text !== '/report') {
    return;
  }
});


async function handleVerify(chatId, phoneNumber) {
  try {
    bot.sendMessage(chatId, `Retrieving information for Phone number: ${phoneNumber}. Please wait...`);
  const apiUrl = `${process.env.API_URL}${phoneNumber}`;

  const options = {
    method: 'GET',
    url: apiUrl,
    headers: {
      'X-API-KEY': process.env.API_KEY
    },
  };
  await axios.request(options)
    .then(response => {
      const fraudInfo = response.data;
      bot.sendMessage(chatId, `Fraud Info for ${phoneNumber}:\n\n${fraudInfo.message}`);
      userStates[chatId] = null; // Reset user state
    })
  } catch (error) {
    console.error('API request error:', error.response.data.statusCode);
      if (error.response.data.statusCode === 404) {
        bot.sendMessage(chatId, `No fraud information found for this number ${phoneNumber}.`);
      } else {
        bot.sendMessage(chatId, 'An error occurred while retrieving fraud information.');
      }
      userStates[chatId] = null; // Reset user state
  }
  
}
async function handleReport(chatId, reporterNumber) {
  try {
    userStates[chatId] = { ...userStates[chatId], reporterNumber: reporterNumber };
  const otpApiUrl = `${process.env.OTP_API_URL}${reporterNumber}`;

  const otpOptions = {
    method: 'GET',
    url: otpApiUrl,
    headers: {
      'X-API-KEY': process.env.API_KEY
    },
    data: reporterNumber
  };

  await axios.request(otpOptions)
    .then(() => {
      bot.sendMessage(chatId, `An OTP will be sent to your number`);
      bot.sendMessage(chatId, `Enter OTP to verify your number: `);
      bot.once('message', (msg) => {
        const otp = msg.text;
        const reporterNumber = userStates[chatId].reporterNumber;
        const verifyOtpUrl = process.env.VERIFY_OTP_API_URL;
        const verifyOtpOptions = {
          method: 'POST',
          url: verifyOtpUrl,
          headers: {
            'X-API-KEY': process.env.API_KEY
          },
          data: {
            'reporterNumber': reporterNumber,
            'code': otp
          }
        };

        axios.request(verifyOtpOptions)
          .then(response => {
            token = response.data.accessToken;
            userStates[chatId] = { ...userStates[chatId], token: token };
            fetchAndDisplayPlatforms(chatId);
          })
          .catch(error => {
            console.error('Error verifying OTP:', error);
            handleError(chatId);
          });
      });
    })  
  } catch (error) {
    console.error('Error sending OTP:', error);
    handleError(chatId);
  }

}

async function fetchAndDisplayPlatforms(chatId) {
  try {
    const platformsUrl = process.env.PLATFORMS_API_URL;
  const platformsOptions = {
    method: 'GET',
    url: platformsUrl,
    headers: {
      'X-API-KEY': process.env.API_KEY
    }
  };

  await axios.request(platformsOptions)
    .then(response => {
      const apiResponse = response.data;
      console.log(apiResponse);

      const keyboard = {
        inline_keyboard: apiResponse.map(platform => [{
          text: platform.displayName,
          callback_data: platform.id
        }])
      };

      bot.sendMessage(chatId, 'Select the social media platform:', { reply_markup: keyboard });
    })  
  } catch (error) {
    console.error('API request error:', error);
    handleError(chatId);  
  }
  
}
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const platformId = query.data;

  if (platformId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
    userStates[chatId] = { ...userStates[chatId], platformId: platformId };
    reportNumber(chatId);
  }

  bot.answerCallbackQuery(query.id);
});


async function reportNumber(chatId) {
  try {
    const reportUrl = process.env.REPORT_NUMBER_API_URL;
  const platformId = userStates[chatId].platformId;
  const userToken = userStates[chatId].token;


  bot.sendMessage(chatId, 'Please enter the suspect number:');
  bot.once('message', (msg) => {
    const suspectNumber = msg.text;

    bot.sendMessage(chatId, 'Please enter the incident date (YYYY-MM-DD):');
    bot.once('message', (msg) => {
      const incidentDate = msg.text;

      bot.sendMessage(chatId, 'Please provide a description (optional):');
      bot.once('message', (msg) => {
        const description = msg.text;

        bot.sendMessage(chatId, 'Please upload an image or file as evidence:');
        bot.once('photo', (msg) => {
          const fileId = msg.photo[msg.photo.length - 1].file_id;

          bot.getFileLink(fileId).then((fileLink) => {
            const formData = new FormData();
            formData.append('suspectNumber', suspectNumber);
            formData.append('platFormId', platformId);
            formData.append('description', description);
            formData.append('incidentDate', incidentDate);

            axios.get(fileLink, { responseType: 'stream' }).then((response) => {
              formData.append('requestFiles', response.data, { filename: 'image.jpg', contentType: 'image/jpeg' });

              const reportOptions = {
                method: 'POST',
                url: reportUrl,
                headers: {
                  'X-API-KEY': process.env.API_KEY,
                  'Authorization': `Bearer ${userToken}`,
                  ...formData.getHeaders()
                },
                data: formData
              };
            
              axiosInstance.request(reportOptions)
                .then(response => {
                  bot.sendMessage(chatId, 'Report submitted successfully!');
                })
                
            });
          });
        });
      });
    });
  });
  } catch (error) {
    console.error('API request error:', error);
    handleError(chatId);
    userStates[chatId] = null;
  }
  }



function handleError(chatId) {
  return error => {
    if (error.response && error.response.data) {
      let errorMessage = '';
      if (Array.isArray(error.response.data.message)) {
        errorMessage = error.response.data.message.join(', ');
      } else if (typeof error.response.data.message === 'string') {
        errorMessage = error.response.data.message;
      } else if (typeof error.response.data === 'string') {
        errorMessage = error.response.data;
      } else {
        errorMessage = JSON.stringify(error.response.data);
      }
      bot.sendMessage(chatId, `Error: ${errorMessage}`);
    } else {
      bot.sendMessage(chatId, 'An error occurred while processing your request.');
    }
    console.error('Full error:', error);
  };
}


