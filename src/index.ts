import express, { Request, Response } from "express";
import dotenv from "dotenv";
import { prisma } from "./lib/prisma";
import Razorpay from "razorpay";
import cors from "cors";
import orders from "razorpay/dist/types/orders.js";
import { OrderStatus } from "@prisma/client";
import crypto from "crypto";

// import { OrderStatus } from "./generated/prisma/enums";

dotenv.config();

const app = express();

const allowedOrigins = [
  "https://jaleifoundation.com",
  "https://www.jaleifoundation.com",
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // allow requests with no origin (curl, mobile apps, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS policy: Origin not allowed"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

/**
 * Preserve raw body for signature verification (webhooks/verify endpoint).
 * This middleware must be used with express.json verify option so req.rawBody is available.
 */
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Apply CORS globally (must be before route handlers)
app.use(cors(corsOptions));

// If you still want an explicit OPTIONS handler, use a RegExp to avoid path-to-regexp parsing issues
app.options(/.*/, cors(corsOptions));

app.post("/student", async (req: Request, res: Response) => {
  const {
    fullName,
    fatherName,
    locationName,
    pincode,
    collegeName,
    studyStream,
    email,
    phoneNumber,
  } = req.body;

  const studentData = {
    fullName,
    fatherName,
    locationName,
    pincode,
    collegeName,
    studyStream,
    email,
    phoneNumber,
  };

  const studentExist = await prisma.student.findFirst({
    where: {
      OR: [{ phoneNumber: phoneNumber }, { email: email }],
    },
  });

  if (studentExist) {
    // Check if new email used by someone else
    const emailExists = await prisma.student.findFirst({
      where: {
        email,
        NOT: { id: studentExist.id },
      },
    });

    if (emailExists) {
      return res.status(409).json({
        message: "Email already belongs to another student",
      });
    }

    // Check if new phone used by someone else
    const phoneExists = await prisma.student.findFirst({
      where: {
        phoneNumber,
        NOT: { id: studentExist.id },
      },
    });

    if (phoneExists) {
      return res.status(409).json({
        message: "Phone number already belongs to another student",
      });
    }

    const updatedStudent = await prisma.student.update({
      where: {
        id: studentExist.id,
      },
      data: studentData,
    });

    return res.status(200).json({
      message: "Student Information Updated",
      data: updatedStudent,
    });
  } else {
    const newStudent = await prisma.student.create({
      data: studentData,
    });
    return res.status(201).json({
      message: "Student Created",
      data: newStudent,
    });
  }
});

app.post("/order", async (req: Request, res: Response) => {
  const { studentId } = req.body;

  console.log(studentId);

  const orderExists = await prisma.order.findFirst({
    where: {
      studentId: studentId,
    },
  });

  console.log(orderExists);

  if (orderExists) {
    if (orderExists.status == OrderStatus.Paid) {
      return res.status(200).json({
        message: "Student has already paid",
      });
    }

    return res.status(200).json({
      order_id: orderExists.orderId,
    });
  } else {
    const instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY as string,
      key_secret: process.env.RAZORPAY_SECRET as string,
    });

    const order = await instance.orders.create({
      amount: 45000,
      currency: "INR",
    });

    await prisma.order.create({
      data: {
        studentId: studentId,
        orderId: order.id,
        amount: order.amount.toString(),
      },
    });

    return res.status(201).json({
      message: "Order Created",
      order_id: order.id,
    });
  }
});

app.post("/verify", async (req: Request, res: Response) => {
  console.log(req.body);
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body;

  const sign = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSign = crypto
    .createHmac("sha256", process.env.RAZORPAY_SECRET as string)
    .update(sign)
    .digest("hex");
  console.log(expectedSign === razorpay_signature);
  if (expectedSign === razorpay_signature) {
    await prisma.order.update({
      where: {
        orderId: razorpay_order_id,
      },
      data: {
        status: OrderStatus.Paid,
      },
    });
    return res.status(200).json({ success: true });
  }
  return res.status(400).json({ success: false });
});
app.listen(3000, () => {
  console.log("Server is Listening on ");
});
