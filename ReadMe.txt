nest g controller users -> create  user module 

nest g controller users -> create user controller  

nest g service users -> create user service 

 

// Install prisma  

npm install prisma --save-dev 
npm install @prisma/client 

 

Initialize Prisma: 

npx prisma init 

 

Generate Prisma client 

npx prisma generate 

 

Set .env 
DATABASE_URL="postgresql://postgres:password@localhost:5432/nest_learning?schema=public" 
postgres → your username 

password → your password 
 
Update schema.prisma 
generator client { 

  provider = "prisma-client-js" 

} 

  

datasource db { 

  provider = "postgresql" 

} 

  

model User { 

  id        Int      @id @default(autoincrement()) 

  name      String 

  email     String   @unique 

  password  String 

  createdAt DateTime @default(now()) 

  updatedAt DateTime @updatedAt 

} 

 

And also create prisma.config.ts 
import 'dotenv/config'; 

import { defineConfig } from 'prisma/config'; 

  

export default defineConfig({ 

  schema: 'prisma/schema.prisma', 

  migrations: { 

    path: 'prisma/migrations', 

  }, 

  datasource: { 

    url: process.env.DATABASE_URL, 

  }, 

}); 

 

Run Migration 
npx prisma migrate dev --name init 

 

 

 

Auth Package 

npm install class-validator class-transformer 
npm install @nestjs/config 
npm install @nestjs/jwt passport passport-jwt 
npm install bcrypt 
npm install -D @types/bcrypt 

 
Generate Modules 

nest g module prisma 

nest g module users 

nest g module auth 

 

nest g service prisma 

nest g service users 

nest g service auth 

 

nest g controller users 

nest g controller auth 

 

 

 