const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const {
  MongoClient,
  ServerApiVersion,
  ObjectId 
} = require('mongodb');

console.log(process.env.PAYMENT_SECRET_KEY, "key");
console.log(process.env.ACCESS_TOKEN_SECRET, "key");
console.log(process.env.DB_PASS);

//env port or 5000 port
const PORT = process.env.PORT || 5000;
//middleware
app.use(cors());
app.use(express.json());


//verify token
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  console.log(authorization);
  if (!authorization) {
    return res.status(401).send({
      error: true,
      message: 'Unauthorized Access'
    });
  }
  // Bearer token
  const token = authorization.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({
        error: true,
        message: 'Unauthorized Access'
      })
    }
    req.decoded = decoded;
    next();
  })
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.lkb5wuy.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect((err) => {
      if (err) {
        console.log(err);
        return;
      }
    });

    //find collection
    const classesCollection = client.db("artandcraft").collection("classes");
    const usersCollection = client.db("artandcraft").collection("users");
    const cartCollection = client.db("artandcraft").collection("carts");
    const paymentCollection=client.db("artandcraft").collection("payments");
    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '1h'
      });
      res.send({
        token
      });
    })


    //verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = {
        email: email
      }
      const user = await usersCollection.findOne(query);
      if (user.role !== 'admin') {
        return res.status(401).send({
          error: true,
          message: 'Unauthorized Access'
        })
      }
      next();
    }




    //get all classes
    app.get('/classes', async (req, res) => {
      const limit = parseInt(req.query.limit);
      const status = req.query.status;
    
      console.log(req.query);
    
      const query = classesCollection.find();
    
      if (limit > 0) {
        query.sort({
          EnrolledStudents: -1
        }).limit(limit);
      }
    
      if (status && status === 'Approved') {
        query.filter({
          status: 'Approved'
        });
      }
    
      const allClasses = await query.toArray();
    
      const pipeline = [
        {
          $match: {
            status: 'Approved'
          }
        },
        {
          $group: {
            _id: "$email",
            totalEnrolledStudents: {
              $sum: "$EnrolledStudents"
            },
            image: {
              $first: "$image"
            },
            instructor_photo: {
              $first: "$instructor_photo"
            },
            instructor: {
              $first: "$instructor"
            },
            classes: {
              $addToSet: "$name"
            }
          }
        },
        {
          $project: {
            _id: 0,
            email: "$_id",
            totalEnrolledStudents: 1,
            image: 1,
            instructor_photo: 1,
            instructor: 1,
            classes: 1
          }
        },
        {
          $sort: {
            totalEnrolledStudents: -1
          }
        }
      ];
    
      const result = await classesCollection.aggregate(pipeline).toArray();
    
      res.json({
        classes: allClasses,
        popularInstructors: result
      });
    });
    

    //post classes
    app.post('/classes', async (req, res) => {
      const classes = req.body;
      const result = await classesCollection.insertOne(classes);
      res.send(result);
    });

    //update single classes by id
    app.patch('/classes/:id', async (req, res) => {
      const id = req.params.id;
      const filter = {
        _id: new ObjectId(id)
      };
      const updateDoc = {};
      console.log(req.body, "body");

      if (req.body.EnrolledStudents || req.body.availableSeats) {
        updateDoc.$set = {
          EnrolledStudents: req.body.EnrolledStudents,
          availableSeats: req.body.availableSeats
        };
      }
      if (req.body.status) {
        updateDoc.$set = {
          status: req.body.status
        };
      }
      if (req.body.name) {
        updateDoc.$set = {
          name: req.body.name
        };
      }
      updateDoc.$set={
        ...req.body
      }

      const result = await classesCollection.updateOne(filter, updateDoc);
      console.log("updating", result);
      res.send(result);
    });

    //get all users
    app.get('/users', async (req, res) => {
      const result = await usersCollection.find().toArray();
      console.log(result, "result");
      res.send(result);
    });

    //get single user by email
    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;
      console.log(email, "email");
      // { $regex: new RegExp(email, 'i')
      const query = {
        email:email  
      };
      console.log(query, "query");
      const user = await usersCollection.findOne(query);
      res.send(user);
    });

    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = "student";
      const query = {
        email: user.email
      }
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({
          message: 'User already exists'
        })
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });
    // route admin 
    app.get('/users/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({
          admin: false
        })
      }
      const query = {
        email: email
      }
      const user = await usersCollection.findOne(query);
      const result = {
        admin: user?.role === 'admin'
      }
      res.send(result);
    })

    //update admin
    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const filter = {
        _id: new ObjectId(id)
      };
      const updateDoc = {
        $set: {
          role: 'admin'
        },
      };

      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);

    })

    //update instructor
    app.patch('/users/instructor/:id', async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const filter = {
        _id: new ObjectId(id)
      };
      const updateDoc = {
        $set: {
          role: 'instructor'
        },
      };

      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    })


    

    // cart collection apis
    app.get('/carts', verifyJWT, async (req, res) => {
      const email = req.query.email;

      if (!email) {
        res.send([]);
      }

      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({
          error: true,
          message: 'forbidden access'
        })
      }
      const query = {
        email: { $regex: new RegExp(email, 'i') }
      };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.post('/carts', async (req, res) => {
      const item = req.body;
      const result = await cartCollection.insertOne(item);
      res.send(result);
    })

    app.delete('/carts/:id', async (req, res) => {
      const id = req.params.id;
      const query = {
        _id: new ObjectId(id)
      };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    })

    //payments collection apis
    app.post('/create-payment-intent',verifyJWT, async (req, res) => {
      const { price } = req.body;
      console.log(price);
      console.log(process.env.PAYMENT_SECRET_KEY, "key");
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      });

      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })


    // payment related api
    app.post('/payments',verifyJWT, async (req, res) => {
      const payment = req.body;
      const insertResult = await paymentCollection.insertOne(payment);
      const query = {
        _id: new ObjectId(payment.cartItem)
      };
      console.log(query, "query");
     // const query = { _id: { $in: payment.cartItems.map(id => new ObjectId(id)) } }
      const deleteResult = await cartCollection.deleteOne(query)

      res.send({ insertResult, deleteResult });
    })
    app.get('/payments',verifyJWT, async (req, res) => {
      const email = req.query.email;

      if (!email) {
        res.send([]);
      }
      const query = {
        email: { $regex: new RegExp(email, 'i') }
      };
      const sort = { date: -1 };
      const result = await paymentCollection.find(query).sort(sort).toArray();
      res.send(result);
    })




    // Send a ping to confirm a successful connection
    await client.db("admin").command({
      ping: 1
    });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Art Craft Server is running');
})
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
})

// https://art-craf-server-jabedweb.vercel.app/classes