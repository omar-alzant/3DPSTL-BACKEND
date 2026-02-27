// src/services/whatsapp.js (Enhanced)
import axios from 'axios';

const API = `https://graph.facebook.com/v24.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
const HEADERS = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };

/**
 * Send an interactive confirm/cancel message for an order
 * @param {string} to - Customer phone number (E.164 format)
 * @param {string} orderId - Unique ID of the order
 * @param {string} summaryText - The body text summarizing the order
 * @returns {object} The response data from the WhatsApp API
 */
export async function sendOrderConfirmation({ to, orderId, summaryText }) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: summaryText },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `confirm_${orderId}`, title: 'Confirm ✅' } },
          { type: 'reply', reply: { id: `cancel_${orderId}`, title: 'Cancel ❌' } },
        ]
      }
    }
  };

  try {
    const { data } = await axios.post(API, payload, { headers: HEADERS });
    return data;
  } catch (error) {
    console.error(`ERROR: Failed to send WhatsApp message for Order ID: ${orderId}`);
    
    // Log the detailed error response from Meta/Axios for debugging
    if (error.response) {
      console.error('Meta API Response Error:', error.response.data);
      // You could throw a more specific error here if needed
      // throw new Error(`WhatsApp API Error: ${JSON.stringify(error.response.data)}`);
    } else {
      console.error('Network or Unknown Error:', error.message);
    }
    
    // Crucial: Throw an error so the calling function (in orders.js) knows it failed
    throw new Error('Failed to send order confirmation via WhatsApp.');
  }
}

// Simple text fallback
export async function sendText({ to, text }) {
  const payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
  
  try {
    const { data } = await axios.post(API, payload, { headers: HEADERS });
    return data;
  } catch (error) {
    console.error(`ERROR: Failed to send simple text message to: ${to}`);
    throw new Error('Failed to send text via WhatsApp.');
  }
}