const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const ejsMate = require('ejs-mate');
const path = require('path');
const mysql = require('mysql');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const app = express();
const port = 3000;
const secreto = crypto.randomBytes(64).toString('hex');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: secreto,
  resave: false,
  saveUninitialized: true,
}));

//-----------------------------------------------BBDD--------------------------------------
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'suites'
});

connection.connect((err) => {
  if (err) {
    console.error('Error al conectar a la base de datos: ', err);
    return;
  }
  console.log('Conexión exitosa a la base de datos');
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: secreto, resave: true, saveUninitialized: true }));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

//--------------------------------------------------------Rutas y vistas-----------------------------------------
app.get('/', (req, res) => {
  connection.query('SELECT * FROM habitaciones', (error, results) => {
    if (error) throw error;
    res.render('index', { habitaciones: results });
  });
});


//-------------------------------------------------------Reserva suite-------------------------------------------
app.get('/reservar_suite/:id', (req, res) => {
  const habitacionId = req.params.id;
  connection.query('SELECT * FROM habitaciones WHERE id = ?', [habitacionId], (error, results) => {
    if (error) throw error;
    res.render('detalle_habitacion', { habitacion: results[0] });
  });
});

app.post('/reservar', async (req, res) => {
  try {
      const { fechaInicio, fechaFin, habitacionId } = req.body;
      const fechaInicioObj = new Date(fechaInicio);
      const fechaFinObj = new Date(fechaFin);
      const disponibilidad = await verificarDisponibilidad(habitacionId, fechaInicio, fechaFin);

      if (!disponibilidad) {
        return res.send(`
        <script>
          alert('No hay disponibilidad en las fechas seleccionadas.');
          window.location.href = '/';
        </script>
      `);
      }
      const usuarioAutenticado = req.session.user;
      if (!usuarioAutenticado) {
          return res.send(`
        <script>
          alert('Debes iniciar sesión para realizar una reserva.');
          window.location.href = '/login';  // Redirigir a la página de inicio de sesión
        </script>
      `);
      }
      const insertReservaQuery = 'INSERT INTO reservas (suite, usuario, fecha_inicio, fecha_fin) VALUES (?, ?, ?, ?)';
      connection.query(insertReservaQuery, [habitacionId, usuarioAutenticado.username, fechaInicio, fechaFin], (error, results) => {
          if (error) {
              console.error(error);
              return res.status(500).send('Error al realizar la reserva.');
          }
          return res.send(`
        <script>
          alert('Reserva realizada. Se enviarán los detalles de la reserva y un recibo al email.');
          window.location.href = '/';
        </script>
      `);
      });
  } catch (error) {
      console.error(error);
      res.status(500).send('Error al procesar la solicitud de reserva.');
  }
});

const verificarDisponibilidad = async (habitacionId, fechaInicio, fechaFin) => {
  const sql = `
    SELECT * FROM reservas WHERE suite = ? AND (
        (fecha_inicio BETWEEN ? AND ?) OR
        (fecha_fin BETWEEN ? AND ?) OR
        (fecha_inicio <= ? AND fecha_fin >= ?)
    )
  `;

  try {
    const results = await queryAsync(sql, [habitacionId, fechaInicio, fechaFin, fechaInicio, fechaFin, fechaInicio, fechaFin]);
    return results.length === 0;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

const queryAsync = (sql, values) => {
  return new Promise((resolve, reject) => {
    connection.query(sql, values, (error, results) => {
      if (error) {
        reject(error);
      } else {
        resolve(results);
      }
    });
  });
};

app.get('/reserva', (req, res) => {
    res.render('reserva');
  });

  app.get('/habitaciones', (req, res) => {
    res.render('habitaciones');
  });

  //----------------------------------------Login---------------------------------------
  app.get('/login', (req, res) => {
    res.render('login');
  });

  app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    let loginError = '';

    try {
        const user = await getUserByUsername(username);
        //let pwd = crypto.createHash('sha256').update(password).digest('hex');
        //const passwordMatch = pwd === user.password;
        const passwordMatch = password === user.password;
        if (!passwordMatch) {
          return res.render('login', { loginError: 'Nombre de usuario o contraseña incorrectos' });
        }
        req.session.user = {
          id: user.id,
          nombre: user.nombre,
          apelldos: user.apellidos,
          username: user.username,
          email: user.email,
          telefono: user.telefono,
          reservas: user.reservas
        };
        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.redirect('/error?mensaje=Error en el servidor');
    }
});

const getUserByUsername = (username) => {
  return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM usuarios WHERE username = ?';
      connection.query(sql, [username], (error, results) => {
          if (error) {
              reject(error);
          } else {
              resolve(results.length > 0 ? results[0] : null);
          }
      });
  });
};

function usuarioAutenticado(req, res, next) {
  if (req.session && req.session.user) {
      return next();
  } else {
      res.redirect('/login');
  }
}

//-------------------------------------------Logout---------------------------------------
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
      if (err) {
          console.error(err);
      }
      res.redirect('/');
  });
});

  //--------------------------------------Registro-----------------------------------
  app.get('/registro', (req, res) => {
    res.render('registro');
  });

  app.post('/registro', async (req, res) => {
    const { nombre, apellidos, username, email, telefono, password } = req.body;
    let emailError = '';
    let usernameError = '';

    try {
        const emailExists = await comprobarUsuario('email', email);
        if (emailExists) {
          emailError = 'El email ya está registrado';
        }
        const usernameExists = await comprobarUsuario('username', username);
        if (usernameExists) {
          usernameError = 'El username ya está en uso';
        }
        if (emailError || usernameError) {
          return res.render('registro', { emailError, usernameError });
        }
        // Encriptar la contraseña antes de almacenarla
        //const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');;

        const sql = 'INSERT INTO usuarios (nombre, apellidos, username, email, telefono, password) VALUES (?, ?, ?, ?, ?, ?)';
        connection.query(sql, [nombre, apellidos, username, email, telefono, password/*hashedPassword*/], (error, results) => {
            if (error) {
                console.error(error);
                return res.redirect('/error?mensaje=Error al registrar el usuario');
            }
            const nomUsuario = username;
            req.session.user = { username: nomUsuario};
            res.redirect('/');
        });
    } catch (error) {
        console.error(error);
        res.render('registro', { errorMessage: 'Error en el servidor' });
    }
});

async function comprobarUsuario(column, value) {
  return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM usuarios WHERE ${column} = ?`;
      connection.query(sql, [value], (error, results) => {
          if (error) {
              reject(error);
          } else {
              resolve(results.length > 0);
          }
      });
  });
}

//--------------------------Ajustes del usuario----------------------
app.get('/ajustesusuario', (req, res) => {
  const usuario = req.session.user;
    const sql = 'SELECT * FROM reservas WHERE usuario = ?';
    connection.query(sql, [usuario.username], (error, results) => {
      if (error) {
        console.error('Error al obtener las reservas del usuario:', error);
        
      } else {
        res.render('ajustesusuario', { reservas: results, usuario: usuario });
      }
    });
  
});

//------------Editar datos---------------------------
app.get('/editar', (req, res) => {
  const usuario = req.session.user;
  res.render('editarusuario', { usuario });
});

app.post('/editar', (req, res) => {
  const { nombre, apellidos, telefono, username, email, contraseña } = req.body;
  const usuarioActual = req.session.user;
  if (hayProblemaDeDisponibilidad) {
    return res.send('<script>alert("Nombre de usuario o correo electrónico no disponibles."); window.location.href = "/editarusuario";</script>');
  }
  const query = 'UPDATE usuarios SET nombre=?, apellidos=?, telefono=?, username=?, email=?, contraseña=? WHERE id=?';
  connection.query(query, [nombre, apellidos, telefono, username, email, contraseña, usuarioActual.id], (error, results) => {
    if (error) {
      console.error('Error al actualizar datos del usuario:', error);
      return res.status(500).send('Error al actualizar datos del usuario.');
    }

    req.session.user = {
      id: usuarioActual.id,
      nombre,
      apellidos,
      telefono,
      username,
      email,
      contraseña,
    };

    res.redirect('/ajustesusuario');
  });
});


//------------------------------Contacto------------------------------
app.get('/contacto', (req, res) => {
  res.render('contacto');
});

app.post('/enviar-contacto', (req, res) => {
  //TO-DO TO-DO TO-DO MIRAR EL BLOC DE NOTAS
  return res.send(`
  <script>
    alert('Formulario de contacto recibido. Nos pondremos en contacto contigo pronto.');
    window.location.href = '/';
  </script>
`);
});

//-------Localizacion-----------------------
app.get('/localizacion', (req, res) => {
  res.render('localizacion');
});

app.listen(port, () => {
  console.log(`El servidor está escuchando en http://localhost:${port}`);
});

