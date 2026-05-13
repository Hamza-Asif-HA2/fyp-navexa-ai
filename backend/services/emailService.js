const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const sendOTPEmail = async (to, otp, name) => {
  try {
    console.log(`Sending OTP email to ${to}`);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background-color: #0A0A0F;
              margin: 0;
              padding: 0;
              color: #FFFFFF;
            }
            .container {
              background-color: #0A0A0F;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .card {
              background-color: #1A1A25;
              border-radius: 12px;
              max-width: 500px;
              width: 100%;
              padding: 40px;
              border: 1px solid #2A2A35;
              box-shadow: 0 10px 40px rgba(108, 99, 255, 0.1);
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .logo {
              font-size: 28px;
              font-weight: bold;
              color: #6C63FF;
              margin-bottom: 10px;
            }
            .title {
              font-size: 24px;
              font-weight: bold;
              margin-bottom: 10px;
              color: #FFFFFF;
            }
            .subtitle {
              font-size: 14px;
              color: #999999;
            }
            .otp-box {
              background-color: #2A2A35;
              border: 2px solid #6C63FF;
              border-radius: 8px;
              padding: 30px;
              text-align: center;
              margin: 30px 0;
            }
            .otp-code {
              font-size: 48px;
              font-weight: bold;
              color: #6C63FF;
              letter-spacing: 8px;
              font-family: 'Courier New', monospace;
            }
            .expiry {
              font-size: 12px;
              color: #999999;
              margin-top: 15px;
              font-style: italic;
            }
            .message {
              font-size: 14px;
              color: #CCCCCC;
              line-height: 1.6;
              margin-bottom: 20px;
            }
            .footer {
              text-align: center;
              font-size: 12px;
              color: #666666;
              border-top: 1px solid #2A2A35;
              padding-top: 20px;
              margin-top: 30px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="card">
              <div class="header">
                <div class="logo">🚗 NavexaAI</div>
                <div class="title">Verify Your Email</div>
                <div class="subtitle">Voice-First AI Vehicle Companion</div>
              </div>
              
              <p class="message">Hi ${name},</p>
              <p class="message">Use the code below to verify your email and activate your NavexaAI account:</p>
              
              <div class="otp-box">
                <div class="otp-code">${otp}</div>
                <div class="expiry">⏱️ This OTP expires in 10 minutes</div>
              </div>
              
              <p class="message">If you didn't request this verification, please ignore this email.</p>
              
              <div class="footer">
                <p>&copy; 2026 NavexaAI. All rights reserved. | Smart Driving, Simplified.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: to,
      subject: "NavexaAI - Verify Your Email",
      html: htmlContent,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ OTP email sent successfully to ${to}`);

    return { success: true };
  } catch (error) {
    console.error("Error sending OTP email:", error.message);
    throw error;
  }
};

const sendWelcomeEmail = async (to, name) => {
  try {
    console.log(`Sending welcome email to ${to}`);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background-color: #0A0A0F;
              margin: 0;
              padding: 0;
              color: #FFFFFF;
            }
            .container {
              background-color: #0A0A0F;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .card {
              background-color: #1A1A25;
              border-radius: 12px;
              max-width: 500px;
              width: 100%;
              padding: 40px;
              border: 1px solid #2A2A35;
              box-shadow: 0 10px 40px rgba(108, 99, 255, 0.1);
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .logo {
              font-size: 28px;
              font-weight: bold;
              color: #6C63FF;
              margin-bottom: 10px;
            }
            .title {
              font-size: 24px;
              font-weight: bold;
              margin-bottom: 10px;
              color: #FFFFFF;
            }
            .subtitle {
              font-size: 14px;
              color: #999999;
            }
            .message {
              font-size: 14px;
              color: #CCCCCC;
              line-height: 1.6;
              margin-bottom: 20px;
            }
            .feature-list {
              background-color: #2A2A35;
              border-left: 3px solid #6C63FF;
              padding: 20px;
              border-radius: 4px;
              margin: 20px 0;
            }
            .feature-item {
              font-size: 14px;
              color: #CCCCCC;
              margin-bottom: 10px;
              padding-left: 20px;
            }
            .feature-item:before {
              content: "✓ ";
              color: #6C63FF;
              font-weight: bold;
              margin-left: -20px;
              margin-right: 10px;
            }
            .cta-button {
              display: inline-block;
              background-color: #6C63FF;
              color: #FFFFFF;
              padding: 12px 30px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
              margin: 20px 0;
              text-align: center;
            }
            .footer {
              text-align: center;
              font-size: 12px;
              color: #666666;
              border-top: 1px solid #2A2A35;
              padding-top: 20px;
              margin-top: 30px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="card">
              <div class="header">
                <div class="logo">🚗 NavexaAI</div>
                <div class="title">Welcome, ${name}!</div>
                <div class="subtitle">Your AI Vehicle Companion Awaits</div>
              </div>
              
              <p class="message">Your NavexaAI account has been successfully created! 🎉</p>
              
              <div class="feature-list">
                <div class="feature-item">Voice-controlled navigation and entertainment</div>
                <div class="feature-item">AI-powered conversation with context awareness</div>
                <div class="feature-item">Personalized music and trip management</div>
                <div class="feature-item">Real-time proactive suggestions</div>
              </div>
              
              <p class="message">Start exploring NavexaAI now and experience the future of driving!</p>
              
              <div class="footer">
                <p>&copy; 2026 NavexaAI. All rights reserved. | Smart Driving, Simplified.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: to,
      subject: `Welcome to NavexaAI, ${name}!`,
      html: htmlContent,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Welcome email sent successfully to ${to}`);

    return { success: true };
  } catch (error) {
    console.error("Error sending welcome email:", error.message);
    throw error;
  }
};

const sendPasswordResetEmail = async (to, otp, name) => {
  try {
    console.log(`Sending password reset email to ${to}`);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background-color: #0A0A0F;
              margin: 0;
              padding: 0;
              color: #FFFFFF;
            }
            .container {
              background-color: #0A0A0F;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .card {
              background-color: #1A1A25;
              border-radius: 12px;
              max-width: 500px;
              width: 100%;
              padding: 40px;
              border: 1px solid #2A2A35;
              box-shadow: 0 10px 40px rgba(108, 99, 255, 0.1);
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .logo {
              font-size: 28px;
              font-weight: bold;
              color: #6C63FF;
              margin-bottom: 10px;
            }
            .title {
              font-size: 24px;
              font-weight: bold;
              margin-bottom: 10px;
              color: #FFFFFF;
            }
            .subtitle {
              font-size: 14px;
              color: #999999;
            }
            .otp-box {
              background-color: #2A2A35;
              border: 2px solid #6C63FF;
              border-radius: 8px;
              padding: 30px;
              text-align: center;
              margin: 30px 0;
            }
            .otp-code {
              font-size: 48px;
              font-weight: bold;
              color: #6C63FF;
              letter-spacing: 8px;
              font-family: 'Courier New', monospace;
            }
            .expiry {
              font-size: 12px;
              color: #999999;
              margin-top: 15px;
              font-style: italic;
            }
            .message {
              font-size: 14px;
              color: #CCCCCC;
              line-height: 1.6;
              margin-bottom: 20px;
            }
            .warning {
              background-color: #2A2A35;
              border-left: 3px solid #FF6B6B;
              padding: 15px;
              border-radius: 4px;
              font-size: 13px;
              color: #FFB3B3;
              margin: 20px 0;
            }
            .footer {
              text-align: center;
              font-size: 12px;
              color: #666666;
              border-top: 1px solid #2A2A35;
              padding-top: 20px;
              margin-top: 30px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="card">
              <div class="header">
                <div class="logo">🚗 NavexaAI</div>
                <div class="title">Reset Your Password</div>
                <div class="subtitle">Secure Account Recovery</div>
              </div>
              
              <p class="message">Hi ${name},</p>
              <p class="message">We received a request to reset your NavexaAI password. Use the code below to complete the process:</p>
              
              <div class="otp-box">
                <div class="otp-code">${otp}</div>
                <div class="expiry">⏱️ This OTP expires in 10 minutes</div>
              </div>
              
              <div class="warning">
                🔒 <strong>Security Notice:</strong> If you didn't request this password reset, please ignore this email. Your account remains secure.
              </div>
              
              <p class="message">Never share this OTP with anyone, including NavexaAI support staff.</p>
              
              <div class="footer">
                <p>&copy; 2026 NavexaAI. All rights reserved. | Smart Driving, Simplified.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: to,
      subject: "NavexaAI - Password Reset",
      html: htmlContent,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Password reset email sent successfully to ${to}`);

    return { success: true };
  } catch (error) {
    console.error("Error sending password reset email:", error.message);
    throw error;
  }
};

module.exports = {
  sendOTPEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
};
