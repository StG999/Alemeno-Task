# Use an official Node.js runtime as a parent image
FROM node:20

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Install PostgreSQL
RUN apt-get update && apt-get install -y postgresql postgresql-contrib

# Start PostgreSQL service
RUN service postgresql start

# Expose ports
EXPOSE 6868 8080 5432

# Command to run your application
CMD ["npm", "start"]
