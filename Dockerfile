FROM node:24

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install
RUN npm rebuild sqlite3

COPY . .

EXPOSE 8080

CMD ["npm", "start"]